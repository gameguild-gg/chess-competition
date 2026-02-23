import React, { useRef } from 'react';
import type { MoveRecord } from '../lib/types';

interface MoveHistoryProps {
  moves: MoveRecord[];
}

export const MoveHistory: React.FC<MoveHistoryProps> = ({ moves }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Calculate accumulated time for each player at each move
  const getAccumulatedTime = (moveIndex: number): { white: number; black: number } => {
    let whiteTime = 0;
    let blackTime = 0;
    for (let i = 0; i <= moveIndex; i++) {
      if (moves[i].color === 'w') {
        whiteTime += moves[i].timeMs;
      } else {
        blackTime += moves[i].timeMs;
      }
    }
    return { white: whiteTime, black: blackTime };
  };

  const formatTime = (ms: number): string => {
    const seconds = ms / 1000;
    return seconds.toFixed(3) + 's';
  };

  // Group moves into pairs (white + black)
  const pairs: { num: number; white?: MoveRecord; black?: MoveRecord }[] = [];
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    if (move.color === 'w') {
      pairs.push({ num: move.moveNumber, white: move });
    } else {
      if (pairs.length > 0 && !pairs[pairs.length - 1].black) {
        pairs[pairs.length - 1].black = move;
      } else {
        pairs.push({ num: move.moveNumber, black: move });
      }
    }
  }

  return (
    <div className="move-history">
      <h3>Move History</h3>
      <div className="move-list">
        {pairs.length === 0 && <p className="no-moves">No moves yet</p>}
        {pairs.map((pair, i) => {
          const moveIndex = pair.white ? moves.indexOf(pair.white) : -1;
          const accTime = moveIndex >= 0 ? getAccumulatedTime(moveIndex) : { white: 0, black: 0 };
          const blackMoveIndex = pair.black ? moves.indexOf(pair.black) : -1;
          const accTimeAfterBlack = blackMoveIndex >= 0 ? getAccumulatedTime(blackMoveIndex) : accTime;

          return (
            <div key={i} className="move-pair">
              <span className="move-num">{pair.num}.</span>
              {pair.white && (
                <span className="move-san white-move" title={`${pair.white.timeMs}ms`}>
                  {pair.white.san} {formatTime(accTime.white)}
                </span>
              )}
              {pair.black && (
                <span className="move-san black-move" title={`${pair.black.timeMs}ms`}>
                  {pair.black.san} {formatTime(accTimeAfterBlack.black)}
                </span>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
