import React from 'react';
import type { GameState, GameResult } from '../lib/types';

interface GameControlsProps {
  gameState: GameState;
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onReset: () => void;
  moveDelay: number;
  onMoveDelayChange: (ms: number) => void;
}

const formatResultLabel = (result: GameResult): string => {
  if (!result) return '';
  if (result.type === 'checkmate') {
    return result.winner === 'w' ? 'White wins by checkmate!' : 'Black wins by checkmate!';
  }
  if (result.type === 'stalemate') return 'Draw by stalemate';
  if (result.type === 'draw-repetition') return 'Draw by threefold repetition';
  if (result.type === 'draw-insufficient') return 'Draw by insufficient material';
  if (result.type === 'draw-50-move') return 'Draw by 50-move rule';
  if (result.type === 'forfeit') {
    const winner = result.loser === 'w' ? 'Black' : 'White';
    if (result.reason === 'timeout') {
      return `${winner} wins — ${result.loser === 'w' ? 'White' : 'Black'} timed out`;
    }
    return `${winner} wins — ${result.loser === 'w' ? 'White' : 'Black'} made an invalid move`;
  }
  return '';
};

export const GameControls: React.FC<GameControlsProps> = ({
  gameState,
  onPlay,
  onPause,
  onStep,
  onReset,
  moveDelay,
  onMoveDelayChange,
}) => {
  const isRunning = gameState.status === 'running';
  const isFinished = gameState.status === 'finished';
  const isIdle = gameState.status === 'idle';
  const isWaitingHuman = gameState.status === 'waiting-human';

  const statusLabel = isWaitingHuman ? 'YOUR TURN' : gameState.status.toUpperCase();

  return (
    <div className="game-controls">
      <div className="controls-buttons">
        {!isRunning && !isWaitingHuman ? (
          <button onClick={onPlay} disabled={isFinished || !gameState.whitePlayer}>
            ▶ Play
          </button>
        ) : (
          <button onClick={onPause}>⏸ Pause</button>
        )}
        <button onClick={onStep} disabled={isRunning || isWaitingHuman || isFinished || !gameState.whitePlayer}>
          ⏭ Step
        </button>
        <button onClick={onReset} disabled={isIdle}>
          ↺ Reset
        </button>
      </div>

      <div className="controls-speed">
        <label>
          Move delay: {moveDelay}ms
          <input
            type="range"
            min={0}
            max={2000}
            step={100}
            value={moveDelay}
            onChange={(e) => onMoveDelayChange(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="controls-status">
        <div className="status-row">
          <span className="status-label">Status:</span>
          <span className={`status-value status-${isWaitingHuman ? 'waiting-human' : gameState.status}`}>
            {statusLabel}
          </span>
        </div>
        <div className="status-row">
          <span className="status-label">Turn:</span>
          <span>{gameState.currentTurn === 'w' ? 'White' : 'Black'}</span>
        </div>
        <div className="status-row">
          <span className="status-label">Moves:</span>
          <span>{gameState.moves.length}</span>
        </div>
        <div className="status-row">
          <span className="status-label">Time limit:</span>
          <span>{(gameState.timeLimitMs / 1000).toFixed(1)}s</span>
        </div>
        {gameState.lastMoveTimeMs > 0 && (
          <div className="status-row">
            <span className="status-label">Last move:</span>
            <span>{gameState.lastMoveTimeMs}ms</span>
          </div>
        )}
      </div>

      {isFinished && gameState.result && (
        <div className="game-result">
          {formatResultLabel(gameState.result)}
        </div>
      )}
    </div>
  );
};
