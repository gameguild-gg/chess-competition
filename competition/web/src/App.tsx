import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BotInfo,
  PlayerInfo,
  GameState,
  GameResult,
  GameWinReason,
  MatchResult,
  TournamentState,
} from './lib/types';
import { GameEngine } from './lib/game-engine';
import { BotSelector } from './components/BotSelector';
import { GameBoard } from './components/GameBoard';
import { MoveHistory } from './components/MoveHistory';
import { GameControls } from './components/GameControls';
import { TournamentBracket } from './components/TournamentBracket';
import { createBracketsTournament, getCurrentMatches, updateMatchResult } from './lib/brackets-tournament';
import './App.css';

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const initialGameState: GameState = {
  status: 'idle',
  result: null,
  fen: INITIAL_FEN,
  moves: [],
  currentTurn: 'w',
  whitePlayer: null,
  blackPlayer: null,
  lastMoveTimeMs: 0,
  timeLimitMs: 10000,
};

function App() {
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [whitePlayer, setWhitePlayer] = useState<PlayerInfo | null>(null);
  const [blackPlayer, setBlackPlayer] = useState<PlayerInfo | null>(null);
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moveDelay, setMoveDelay] = useState(500);
  const [timeLimitMs, setTimeLimitMs] = useState(10000);
  const [tournamentTimeLimitMs, setTournamentTimeLimitMs] = useState(10000);
  const [tournament, setTournament] = useState<TournamentState | null>(null);
  const [tournamentRunning, setTournamentRunning] = useState(false);
  const engineRef = useRef<GameEngine | null>(null);

  // Fetch manifest on mount
  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    fetch(`${base}bots/manifest.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.status}`);
        return res.json();
      })
      .then((data: BotInfo[]) => setBots(data))
      .catch((err) => setError(`Could not load bot list: ${err.message}`));
  }, []);

  // State change callback for engine
  const onStateChange = useCallback((state: GameState) => {
    setGameState(state);
  }, []);

  // Initialize engine
  useEffect(() => {
    engineRef.current = new GameEngine(onStateChange);
    return () => {
      engineRef.current?.cleanup();
    };
  }, [onStateChange]);

  // Update move delay in engine
  useEffect(() => {
    engineRef.current?.setMoveDelay(moveDelay);
  }, [moveDelay]);

  // Update time limit in engine
  useEffect(() => {
    engineRef.current?.setTimeLimit(timeLimitMs);
  }, [timeLimitMs]);

  const getWinnerColor = (result: GameResult): 'w' | 'b' | null => {
    if (!result) return null;
    if (result.type === 'checkmate') return result.winner;
    if (result.type === 'forfeit') return result.loser === 'w' ? 'b' : 'w';
    return null;
  };

  const getMoveTimeTotals = (moves: GameState['moves']): { white: number; black: number } => {
    return moves.reduce(
      (acc, move) => {
        if (move.color === 'w') {
          acc.white += move.timeMs;
        } else {
          acc.black += move.timeMs;
        }
        return acc;
      },
      { white: 0, black: 0 },
    );
  };

  const formatReason = (reason: string): string => {
    const map: Record<string, string> = {
      checkmate: 'checkmate',
      stalemate: 'stalemate',
      timeout: 'timeout',
      'invalid-move': 'invalid move',
      'draw-repetition': 'draw (repetition)',
      'draw-insufficient': 'draw (insufficient material)',
      'draw-50-move': 'draw (50-move rule)',
      forfeit: 'forfeit',
      'time-advantage': 'time advantage',
    };
    return map[reason] ?? reason;
  };

  const getGameWinReason = (result: GameResult): GameWinReason => {
    if (!result) return 'draw-50-move';
    if (result.type === 'checkmate') return 'checkmate';
    if (result.type === 'stalemate') return 'stalemate';
    if (result.type === 'draw-repetition') return 'draw-repetition';
    if (result.type === 'draw-insufficient') return 'draw-insufficient';
    if (result.type === 'draw-50-move') return 'draw-50-move';
    if (result.type === 'forfeit') {
      return result.reason === 'timeout' ? 'timeout' : 'invalid-move';
    }
    return 'draw-50-move';
  };

  const playBotMatch = async (
    whiteBot: BotInfo,
    blackBot: BotInfo,
    tournamentTimeLimitMs: number = timeLimitMs,
  ): Promise<{
    winner: BotInfo;
    loser: BotInfo;
    gameResults: MatchResult[];
    matchTotalTimeMs: Record<string, number>;
  }> => {
    if (!engineRef.current) {
      throw new Error('Game engine not ready');
    }

    const originalTimeLimit = engineRef.current.getTimeLimit();
    engineRef.current.setTimeLimit(tournamentTimeLimitMs);

    const matchTotalTimeMs: Record<string, number> = { [whiteBot.username]: 0, [blackBot.username]: 0 };

    try {
      setWhitePlayer({ type: 'bot', bot: whiteBot });
      setBlackPlayer({ type: 'bot', bot: blackBot });
      await engineRef.current.loadPlayers(
        { type: 'bot', bot: whiteBot },
        { type: 'bot', bot: blackBot },
      );
      await engineRef.current.play();

      const state = engineRef.current.getState();
      if (state.status !== 'finished') {
        throw new Error('Match aborted');
      }

      const totals = getMoveTimeTotals(state.moves);
      matchTotalTimeMs[whiteBot.username] += totals.white;
      matchTotalTimeMs[blackBot.username] += totals.black;

      const winnerColor = getWinnerColor(state.result);
      const reason = getGameWinReason(state.result);
      const isDraw =
        !!state.result &&
        (state.result.type === 'stalemate' ||
          state.result.type === 'draw-repetition' ||
          state.result.type === 'draw-insufficient' ||
          state.result.type === 'draw-50-move');

      if (isDraw) {
        const totalsDraw = getMoveTimeTotals(state.moves);
        const winner = totalsDraw.white <= totalsDraw.black ? whiteBot : blackBot;
        const loser = winner === whiteBot ? blackBot : whiteBot;
        return {
          winner,
          loser,
          gameResults: [{ winner, loser, reason: 'time-advantage' }],
          matchTotalTimeMs,
        };
      }

      if (winnerColor === 'w') {
        return {
          winner: whiteBot,
          loser: blackBot,
          gameResults: [{ winner: whiteBot, loser: blackBot, reason }],
          matchTotalTimeMs,
        };
      }
      return {
        winner: blackBot,
        loser: whiteBot,
        gameResults: [{ winner: blackBot, loser: whiteBot, reason }],
        matchTotalTimeMs,
      };
    } finally {
      engineRef.current.setTimeLimit(originalTimeLimit);
    }
  };

  const handleStartTournament = async () => {
    if (tournamentRunning || bots.length < 2) return;
    setError(null);
    setTournamentRunning(true);
    try {
      const ctx = await createBracketsTournament(bots);
      const { manager, storage, stageId, participantMap } = ctx;

      const trackHeadToHead = (h2h: Record<string, { wins: number; losses: number }>, winner: BotInfo, loser: BotInfo) => {
        const names = [winner.username, loser.username].sort();
        const key = names.join('-vs-');
        if (!h2h[key]) h2h[key] = { wins: 0, losses: 0 };
        if (winner.username === names[0]) h2h[key].wins++;
        else h2h[key].losses++;
      };

      let headToHead: Record<string, { wins: number; losses: number }> = {};
      const baseState: TournamentState = {
        status: 'running',
        rounds: [],
        currentMatchId: null,
        champion: null,
        runnerUp: null,
        thirdPlace: null,
        fourthPlace: null,
        headToHead: {},
        tournamentTimeLimitMs: tournamentTimeLimitMs,
        matchLog: [],
      };

      const refreshViewerData = () =>
        manager.get.tournamentData(ctx.tournamentId).then((data) => ({
          stages: data.stage,
          matches: data.match,
          matchGames: data.match_game,
          participants: data.participant,
        }));

      baseState.bracketsViewerData = await refreshViewerData();
      setTournament({ ...baseState, bracketsViewerData: baseState.bracketsViewerData });

      while (true) {
        const currentMatches = await getCurrentMatches(storage, stageId);
        const match = currentMatches.find(
          (m) => m.opponent1?.id != null && m.opponent2?.id != null && participantMap.has(m.opponent1!.id!) && participantMap.has(m.opponent2!.id!),
        ) as { id: number; opponent1?: { id: number | null }; opponent2?: { id: number | null } } | undefined;
        if (!match) break;

        const matchId = match.id;
        const pid1 = match.opponent1!.id!;
        const pid2 = match.opponent2!.id!;
        const whiteBot = participantMap.get(pid1)!;
        const blackBot = participantMap.get(pid2)!;

        setTournament((prev) => (prev ? { ...prev, currentMatchBots: { white: whiteBot, black: blackBot } } : prev));
        await new Promise((r) => setTimeout(r, 0));

        const result = await playBotMatch(whiteBot, blackBot, tournamentTimeLimitMs);
        for (const gr of result.gameResults) {
          baseState.matchLog!.push({
            white: whiteBot.username,
            black: blackBot.username,
            winner: gr.winner.username,
            reason: gr.reason,
          });
        }
        setTournament((prev) => (prev ? { ...prev, matchLog: baseState.matchLog } : prev));

        trackHeadToHead(headToHead, result.winner, result.loser);

        let winnerScore = result.gameResults.filter((r) => r.winner.username === result.winner.username).length;
        let loserScore = result.gameResults.length - winnerScore;
        let matchWinner = result.winner;
        let matchLoser = result.loser;

        if (winnerScore === loserScore) {
          const timeW = result.matchTotalTimeMs[whiteBot.username] ?? 0;
          const timeB = result.matchTotalTimeMs[blackBot.username] ?? 0;
          matchWinner = timeW <= timeB ? whiteBot : blackBot;
          matchLoser = matchWinner === whiteBot ? blackBot : whiteBot;
          winnerScore = 2;
          loserScore = 1;
        }

        await updateMatchResult(
          manager,
          matchId,
          match,
          ctx.botToParticipantId.get(matchWinner.username)!,
          ctx.botToParticipantId.get(matchLoser.username)!,
          winnerScore,
          loserScore,
        );

        baseState.bracketsViewerData = await refreshViewerData();
        setTournament((prev) => (prev ? { ...prev, bracketsViewerData: baseState.bracketsViewerData, currentMatchBots: null } : prev));
      }

      const standings = await manager.get.finalStandings(stageId);
      const idToBot = (id: number) => participantMap.get(id) ?? null;
      const champion = standings[0] ? idToBot((standings[0] as { id: number }).id) : null;
      const runnerUp = standings[1] ? idToBot((standings[1] as { id: number }).id) : null;
      const thirdPlace = standings[2] ? idToBot((standings[2] as { id: number }).id) : null;
      const fourthPlace = standings[3] ? idToBot((standings[3] as { id: number }).id) : null;

      baseState.bracketsViewerData = await refreshViewerData();
      setTournament({
        ...baseState,
        bracketsViewerData: baseState.bracketsViewerData,
        status: 'finished',
        champion,
        runnerUp,
        thirdPlace,
        fourthPlace,
        headToHead,
        matchLog: baseState.matchLog,
        currentMatchId: null,
        currentMatchBots: null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Tournament failed: ${msg}`);
    } finally {
      setTournamentRunning(false);
    }
  };

  const handleResetTournament = () => {
    if (tournamentRunning) return;
    setTournament(null);
    setTournamentRunning(false);
  };

  const handleStart = async () => {
    if (!whitePlayer || !blackPlayer || !engineRef.current) return;
    setError(null);
    setLoading(true);
    try {
      await engineRef.current.loadPlayers(whitePlayer, blackPlayer);
      setLoading(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setLoading(false);
    }
  };

  const handlePlay = () => {
    engineRef.current?.play();
  };

  const handlePause = () => {
    engineRef.current?.pause();
  };

  const handleStep = () => {
    engineRef.current?.step();
  };

  const handleReset = () => {
    engineRef.current?.reset();
  };

  const handleHumanMove = useCallback(
    (from: string, to: string, promotion?: string): boolean => {
      if (!engineRef.current) return false;
      return engineRef.current.submitHumanMove(from, to, promotion);
    },
    [],
  );

  const gameActive = gameState.status !== 'idle' || loading;
  const tournamentActive = tournamentRunning || tournament?.status === 'running';
  const currentMatchBots = tournament?.currentMatchBots ?? null;

  // Determine board orientation: if a human is playing black (and white is a bot), flip the board
  const boardOrientation: 'white' | 'black' =
    whitePlayer?.type === 'bot' && blackPlayer?.type === 'human' ? 'black' : 'white';

  return (
    <div className="app">
      <header className="app-header">
        <h1>&#9823; Chess Competition</h1>
        <p>Select two bots, or play against a bot yourself!</p>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <BotSelector
        bots={bots}
        whitePlayer={whitePlayer}
        blackPlayer={blackPlayer}
        onWhiteChange={setWhitePlayer}
        onBlackChange={setBlackPlayer}
        onStart={handleStart}
        disabled={gameActive || tournamentActive}
        loading={loading}
        timeLimitMs={timeLimitMs}
        onTimeLimitChange={setTimeLimitMs}
      />

      <div className="tournament-panel">
        <h2>Bot Tournament</h2>
        <p className="tournament-subtitle">
          Double-elimination, randomized bracket. Losers drop to loser bracket;
          champion must lose twice to be eliminated. Best-of-3 series per match.
          Uses the bot time limit above.
        </p>
        <div className="tournament-actions">
          <div className="tournament-controls">
            <label htmlFor="tournament-move-delay">Move Delay (ms):</label>
            <input
              id="tournament-move-delay"
              type="range"
              min="0"
              max="5000"
              step="100"
              value={moveDelay}
              onChange={(e) => setMoveDelay(parseInt(e.target.value, 10))}
              disabled={tournamentRunning}
            />
            <span className="delay-value">{moveDelay}ms</span>
          </div>
          <div className="tournament-controls">
            <label htmlFor="tournament-time-limit">Bot Time Limit (ms):</label>
            <input
              id="tournament-time-limit"
              type="range"
              min="1000"
              max="60000"
              step="1000"
              value={tournamentTimeLimitMs}
              onChange={(e) => setTournamentTimeLimitMs(parseInt(e.target.value, 10))}
              disabled={tournamentRunning}
            />
            <span className="delay-value">{tournamentTimeLimitMs}ms</span>
          </div>
          <button
            className="btn-start"
            onClick={handleStartTournament}
            disabled={tournamentActive || bots.length < 2 || loading}
          >
            {tournamentActive ? 'Tournament Running...' : 'Start Tournament'}
          </button>
          <button
            className="btn-secondary"
            onClick={handleResetTournament}
            disabled={tournamentActive || !tournament}
          >
            Reset Tournament
          </button>
        </div>

        {currentMatchBots && (
          <div className="tournament-status">
            Now playing: {currentMatchBots.white.username} vs {currentMatchBots.black.username}
          </div>
        )}

        <TournamentBracket tournament={tournament} />
      </div>

      {(gameState.whitePlayer || loading) && (
        <div className="game-layout">
          <div className="game-left">
            <GameBoard
              gameState={gameState}
              onHumanMove={handleHumanMove}
              boardOrientation={boardOrientation}
            />
            {tournament?.matchLog && tournament.matchLog.length > 0 && (
              <div className="match-log-panel">
                <h3>Match results</h3>
                <ul className="match-log-list">
                  {tournament.matchLog.map((entry, i) => (
                    <li key={i} className="match-log-line">
                      {entry.white} vs {entry.black}: {entry.winner} won ({formatReason(entry.reason)})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="game-right">
            {!tournamentActive ? (
              <GameControls
                gameState={gameState}
                onPlay={handlePlay}
                onPause={handlePause}
                onStep={handleStep}
                onReset={handleReset}
                moveDelay={moveDelay}
                onMoveDelayChange={setMoveDelay}
              />
            ) : (
              <div className="tournament-info">
                Tournament in progress — matches are played automatically.
              </div>
            )}
            <MoveHistory moves={gameState.moves} currentFen={gameState.fen} />
          </div>
        </div>
      )}

      {bots.length === 0 && !error && (
        <div className="loading">Loading bots...</div>
      )}
    </div>
  );
}

export default App;
