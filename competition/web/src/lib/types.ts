export interface BotInfo {
  username: string;
  avatar: string;
  forkUrl: string;
}

export type PlayerType = 'bot' | 'human';

export interface PlayerInfo {
  type: PlayerType;
  bot: BotInfo | null; // null when type === 'human'
}

export const HUMAN_PLAYER: PlayerInfo = {
  type: 'human',
  bot: null,
};

export type GameStatus =
  | 'idle'
  | 'waiting-human' // waiting for a human move
  | 'running'
  | 'paused'
  | 'finished';

export type GameResult =
  | { type: 'checkmate'; winner: 'w' | 'b' }
  | { type: 'stalemate' }
  | { type: 'draw-repetition' }
  | { type: 'draw-insufficient' }
  | { type: 'draw-50-move' }
  | { type: 'forfeit'; loser: 'w' | 'b'; reason: 'invalid' | 'timeout' }
  | null;

export interface MoveRecord {
  moveNumber: number;
  san: string;
  uci: string;
  fen: string;
  color: 'w' | 'b';
  timeMs: number;
}

export interface GameState {
  status: GameStatus;
  result: GameResult;
  fen: string;
  moves: MoveRecord[];
  currentTurn: 'w' | 'b';
  whitePlayer: PlayerInfo | null;
  blackPlayer: PlayerInfo | null;
  lastMoveTimeMs: number;
  timeLimitMs: number;
}

export type TournamentStatus = 'idle' | 'running' | 'finished';

export type TournamentMatchStatus = 'pending' | 'running' | 'finished' | 'bye';

export type GameWinReason = 
  | 'checkmate'
  | 'stalemate'
  | 'timeout'
  | 'invalid-move'
  | 'draw-repetition'
  | 'draw-insufficient'
  | 'draw-50-move'
  | 'forfeit'
  | 'time-advantage';

export interface MatchResult {
  winner: BotInfo;
  loser: BotInfo;
  reason: GameWinReason;
}

export interface TournamentMatch {
  id: string;
  roundIndex: number;
  matchIndex: number;
  whiteBot: BotInfo | null;
  blackBot: BotInfo | null;
  gameResults: MatchResult[]; // Array of game results in this match (for best-of-3)
  winner: BotInfo | null;
  loser: BotInfo | null;
  status: TournamentMatchStatus;
}

export interface TournamentRound {
  title: string;
  matches: TournamentMatch[];
}

/** Viewer data for brackets-viewer (double elimination) */
export interface BracketsViewerData {
  stages: unknown[];
  matches: unknown[];
  matchGames: unknown[];
  participants: unknown[];
}

export interface TournamentState {
  status: TournamentStatus;
  rounds: TournamentRound[];
  currentMatchId: string | null;
  champion: BotInfo | null;
  runnerUp: BotInfo | null;
  thirdPlace: BotInfo | null;
  fourthPlace: BotInfo | null;
  headToHead: Record<string, { wins: number; losses: number }>; // Key: "botA-vs-botB" (sorted)
  tournamentTimeLimitMs: number; // Max time per bot per move in tournament
  /** Brackets-viewer data (when using double elimination) */
  bracketsViewerData?: BracketsViewerData | null;
  /** Current match participants for "Now playing" display */
  currentMatchBots?: { white: BotInfo; black: BotInfo } | null;
  /** Log of match results (one line per game): white vs black, winner, reason */
  matchLog?: { white: string; black: string; winner: string; reason: string }[];
}

// Messages from main thread -> worker
export type WorkerInMessage =
  | { type: 'load'; botUrl: string }
  | { type: 'move'; fen: string; timeLimitMs: number };

// Messages from worker -> main thread
export type WorkerOutMessage =
  | { type: 'ready' }
  | { type: 'result'; uci: string }
  | { type: 'error'; message: string };
