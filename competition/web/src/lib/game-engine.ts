import { Chess } from 'chess.js';
import type {
  BotInfo,
  PlayerInfo,
  GameState,
  GameResult,
  MoveRecord,
  WorkerInMessage,
  WorkerOutMessage,
} from './types';

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const DEFAULT_TIME_LIMIT_MS = 10000;
const DEFAULT_MOVE_DELAY_MS = 500;

export class GameEngine {
  private chess: Chess;
  private whiteWorker: Worker | null = null;
  private blackWorker: Worker | null = null;
  private whiteReady = false;
  private blackReady = false;
  private state: GameState;
  private onStateChange: (state: GameState) => void;
  private moveDelayMs: number;
  private timeLimitMs: number;
  private abortController: AbortController | null = null;
  private stepping = false;

  // Human move support
  private humanMoveResolve: ((uci: string) => void) | null = null;

  constructor(onStateChange: (state: GameState) => void) {
    this.chess = new Chess();
    this.moveDelayMs = DEFAULT_MOVE_DELAY_MS;
    this.timeLimitMs = DEFAULT_TIME_LIMIT_MS;
    this.onStateChange = onStateChange;
    this.state = this.buildState('idle', null);
  }

  private buildState(
    status: GameState['status'],
    result: GameResult,
  ): GameState {
    return {
      status,
      result,
      fen: this.chess.fen(),
      moves: [...(this.state?.moves ?? [])],
      currentTurn: this.chess.turn(),
      whitePlayer: this.state?.whitePlayer ?? null,
      blackPlayer: this.state?.blackPlayer ?? null,
      lastMoveTimeMs: this.state?.lastMoveTimeMs ?? 0,
      timeLimitMs: this.timeLimitMs,
    };
  }

  private emit(status: GameState['status'], result: GameResult) {
    this.state = this.buildState(status, result);
    this.onStateChange({ ...this.state });
  }

  getState(): GameState {
    return { ...this.state };
  }

  setMoveDelay(ms: number) {
    this.moveDelayMs = ms;
  }

  setTimeLimit(ms: number) {
    this.timeLimitMs = ms;
  }

  getTimeLimit(): number {
    return this.timeLimitMs;
  }

  private isHumanTurn(): boolean {
    const turn = this.chess.turn();
    const player = turn === 'w' ? this.state.whitePlayer : this.state.blackPlayer;
    return player?.type === 'human';
  }

  async loadPlayers(whitePlayer: PlayerInfo, blackPlayer: PlayerInfo): Promise<void> {
    this.cleanup();
    this.chess = new Chess();
    this.state = {
      status: 'idle',
      result: null,
      fen: INITIAL_FEN,
      moves: [],
      currentTurn: 'w',
      whitePlayer,
      blackPlayer,
      lastMoveTimeMs: 0,
      timeLimitMs: this.timeLimitMs,
    };

    const base = import.meta.env.BASE_URL;
    const loadPromises: Promise<void>[] = [];

    // Create worker for white bot
    if (whitePlayer.type === 'bot' && whitePlayer.bot) {
      this.whiteWorker = new Worker(
        new URL('../workers/bot-worker.ts', import.meta.url),
        { type: 'module' },
      );
      const whiteReady = this.waitForReady(this.whiteWorker, 'white');
      const whiteMsg: WorkerInMessage = {
        type: 'load',
        botUrl: `${base}bots/${whitePlayer.bot.username}.js`,
      };
      this.whiteWorker.postMessage(whiteMsg);
      loadPromises.push(whiteReady);
    }

    // Create worker for black bot
    if (blackPlayer.type === 'bot' && blackPlayer.bot) {
      this.blackWorker = new Worker(
        new URL('../workers/bot-worker.ts', import.meta.url),
        { type: 'module' },
      );
      const blackReady = this.waitForReady(this.blackWorker, 'black');
      const blackMsg: WorkerInMessage = {
        type: 'load',
        botUrl: `${base}bots/${blackPlayer.bot.username}.js`,
      };
      this.blackWorker.postMessage(blackMsg);
      loadPromises.push(blackReady);
    }

    if (loadPromises.length > 0) {
      await Promise.all(loadPromises);
    }
    this.emit('idle', null);
  }

  private waitForReady(worker: Worker, side: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${side} bot failed to load within 30s`));
      }, 30000);

      const handler = (e: MessageEvent<WorkerOutMessage>) => {
        if (e.data.type === 'ready') {
          clearTimeout(timeout);
          worker.removeEventListener('message', handler);
          if (side === 'white') this.whiteReady = true;
          else this.blackReady = true;
          resolve();
        } else if (e.data.type === 'error') {
          clearTimeout(timeout);
          worker.removeEventListener('message', handler);
          reject(new Error(`${side} bot load error: ${e.data.message}`));
        }
      };

      worker.addEventListener('message', handler);
    });
  }

  async play(): Promise<void> {
    if (this.state.status === 'finished') return;
    if (this.state.status === 'running') return;

    this.abortController = new AbortController();

    // If it's a human's turn, go to waiting-human instead of running
    if (this.isHumanTurn()) {
      this.emit('waiting-human', null);
    } else {
      this.emit('running', null);
    }

    try {
      await this.gameLoop(this.abortController.signal);
    } catch {
      // Aborted (pause/reset)
    }
  }

  pause(): void {
    if (this.state.status !== 'running' && this.state.status !== 'waiting-human') return;
    this.abortController?.abort();
    this.abortController = null;
    // If waiting for human, clear the pending promise
    if (this.humanMoveResolve) {
      this.humanMoveResolve = null;
    }
    this.emit('paused', null);
  }

  async step(): Promise<void> {
    if (this.state.status === 'finished') return;
    if (this.state.status === 'running') return;

    // For human turns, enter waiting-human mode so the board becomes interactive
    if (this.isHumanTurn()) {
      this.abortController = new AbortController();
      this.emit('waiting-human', null);
      try {
        await this.executeSingleMove();
      } catch {
        // aborted
      }
      return;
    }

    this.stepping = true;
    await this.executeSingleMove();
    this.stepping = false;
  }

  /** Called by the UI when a human makes a move on the board */
  submitHumanMove(from: string, to: string, promotion?: string): boolean {
    // Validate the move
    const uci = from + to + (promotion ?? '');
    try {
      const result = this.chess.move({ from, to, promotion });
      if (!result) return false;

      // Record the move
      const moveRecord: MoveRecord = {
        moveNumber: Math.ceil(this.state.moves.length / 2) + 1,
        san: result.san,
        uci,
        fen: this.chess.fen(),
        color: result.color as 'w' | 'b',
        timeMs: 0,
      };
      this.state.moves.push(moveRecord);
      this.state.lastMoveTimeMs = 0;

      // Resolve the pending human move promise
      if (this.humanMoveResolve) {
        this.humanMoveResolve(uci);
        this.humanMoveResolve = null;
      }

      return true;
    } catch {
      return false;
    }
  }

  reset(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.humanMoveResolve = null;
    this.chess = new Chess();
    this.state = {
      ...this.state,
      status: 'idle',
      result: null,
      fen: INITIAL_FEN,
      moves: [],
      currentTurn: 'w',
      lastMoveTimeMs: 0,
    };
    this.emit('idle', null);
  }

  private async gameLoop(signal: AbortSignal): Promise<void> {
    while (!this.chess.isGameOver() && !signal.aborted) {
      await this.executeSingleMove();

      if (this.state.status === 'finished') return;
      if (signal.aborted) return;

      // Inter-move delay for visualization (only between bot moves)
      if (!signal.aborted && this.moveDelayMs > 0 && !this.isHumanTurn()) {
        await this.delay(this.moveDelayMs, signal);
      }
    }

    if (!signal.aborted && this.chess.isGameOver()) {
      this.finishGame();
    }
  }

  private async executeSingleMove(): Promise<void> {
    const turn = this.chess.turn();
    const player = turn === 'w' ? this.state.whitePlayer : this.state.blackPlayer;

    if (!player) {
      this.emit('finished', { type: 'forfeit', loser: turn, reason: 'invalid' });
      return;
    }

    if (player.type === 'human') {
      await this.executeHumanMove();
    } else {
      await this.executeBotMove(turn);
    }
  }

  private async executeHumanMove(): Promise<void> {
    this.emit('waiting-human', null);

    // Wait for the human to make a move via submitHumanMove()
    await new Promise<string>((resolve, reject) => {
      this.humanMoveResolve = resolve;

      // Listen for abort
      const signal = this.abortController?.signal;
      if (signal) {
        const onAbort = () => {
          this.humanMoveResolve = null;
          reject(new Error('aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });

    // The move was already applied in submitHumanMove, so just check game over
    if (this.chess.isGameOver()) {
      this.finishGame();
    } else if (!this.stepping) {
      if (this.isHumanTurn()) {
        this.emit('waiting-human', null);
      } else {
        this.emit('running', null);
      }
    } else {
      this.emit('paused', null);
    }
  }

  private async executeBotMove(turn: 'w' | 'b'): Promise<void> {
    const worker = turn === 'w' ? this.whiteWorker : this.blackWorker;

    if (!worker) {
      this.emit('finished', { type: 'forfeit', loser: turn, reason: 'invalid' });
      return;
    }

    this.emit('running', null);

    const fen = this.chess.fen();
    const startTime = performance.now();

    let uci: string;
    try {
      uci = await this.requestMove(worker, fen, turn);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('timeout')) {
        this.emit('finished', { type: 'forfeit', loser: turn, reason: 'timeout' });
      } else {
        this.emit('finished', { type: 'forfeit', loser: turn, reason: 'invalid' });
      }
      return;
    }

    const elapsed = performance.now() - startTime;

    // Validate and apply the move
    try {
      const from = uci.substring(0, 2);
      const to = uci.substring(2, 4);
      const promotion = uci.length > 4 ? uci[4] : undefined;

      const moveResult = this.chess.move({ from, to, promotion });

      if (!moveResult) {
        this.emit('finished', { type: 'forfeit', loser: turn, reason: 'invalid' });
        return;
      }

      const moveRecord: MoveRecord = {
        moveNumber: Math.ceil(this.state.moves.length / 2) + 1,
        san: moveResult.san,
        uci,
        fen: this.chess.fen(),
        color: turn,
        timeMs: Math.round(elapsed),
      };

      this.state.moves.push(moveRecord);
      this.state.lastMoveTimeMs = Math.round(elapsed);

      if (this.chess.isGameOver()) {
        this.finishGame();
      } else if (!this.stepping) {
        if (this.isHumanTurn()) {
          this.emit('waiting-human', null);
        } else {
          this.emit('running', null);
        }
      } else {
        this.emit('paused', null);
      }
    } catch {
      this.emit('finished', { type: 'forfeit', loser: turn, reason: 'invalid' });
    }
  }

  private requestMove(worker: Worker, fen: string, turn: 'w' | 'b'): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.removeEventListener('message', handler);
        reject(new Error(`timeout: ${turn === 'w' ? 'White' : 'Black'} bot exceeded time limit`));
      }, this.timeLimitMs + 1000); // +1s grace for WASM overhead

      const handler = (e: MessageEvent<WorkerOutMessage>) => {
        clearTimeout(timeout);
        worker.removeEventListener('message', handler);

        if (e.data.type === 'result') {
          resolve(e.data.uci);
        } else if (e.data.type === 'error') {
          reject(new Error(e.data.message));
        }
      };

      worker.addEventListener('message', handler);

      const msg: WorkerInMessage = {
        type: 'move',
        fen,
        timeLimitMs: this.timeLimitMs,
      };
      worker.postMessage(msg);
    });
  }

  private finishGame(): void {
    let result: GameResult = null;

    if (this.chess.isCheckmate()) {
      const winner = this.chess.turn() === 'w' ? 'b' : 'w';
      result = { type: 'checkmate', winner };
    } else if (this.chess.isStalemate()) {
      result = { type: 'stalemate' };
    } else if (this.chess.isThreefoldRepetition()) {
      result = { type: 'draw-repetition' };
    } else if (this.chess.isInsufficientMaterial()) {
      result = { type: 'draw-insufficient' };
    } else if (this.chess.isDraw()) {
      result = { type: 'draw-50-move' };
    }

    this.emit('finished', result);
  }

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      }, { once: true });
    });
  }

  cleanup(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.humanMoveResolve = null;
    this.whiteWorker?.terminate();
    this.blackWorker?.terminate();
    this.whiteWorker = null;
    this.blackWorker = null;
    this.whiteReady = false;
    this.blackReady = false;
  }
}
