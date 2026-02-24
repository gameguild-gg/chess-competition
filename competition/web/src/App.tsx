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
import { buildRound, shuffleBots } from './lib/tournament';
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
  ) => {
    if (!engineRef.current) {
      throw new Error('Game engine not ready');
    }

    const originalTimeLimit = engineRef.current.getTimeLimit();
    engineRef.current.setTimeLimit(tournamentTimeLimitMs);

    try {
      let whiteBotWins = 0;
      let blackBotWins = 0;
      let gameNumber = 1;
      let game2Winner: BotInfo | null = null;
      let game2Loser: BotInfo | null = null;
      const gameResults: MatchResult[] = [];

      // Play up to 3 games
      while (gameNumber <= 3) {
        // Determine colors for this game
        let currentWhiteBot: BotInfo;
        let currentBlackBot: BotInfo;

        if (gameNumber <= 2) {
          // Games 1-2: keep same colors (white stays white, black stays black)
          currentWhiteBot = whiteBot;
          currentBlackBot = blackBot;
        } else {
          // Game 3: loser of game 2 plays as white
          if (game2Winner === whiteBot) {
            currentWhiteBot = blackBot;
            currentBlackBot = whiteBot;
          } else {
            currentWhiteBot = whiteBot;
            currentBlackBot = blackBot;
          }
        }

        setWhitePlayer({ type: 'bot', bot: currentWhiteBot });
        setBlackPlayer({ type: 'bot', bot: currentBlackBot });
        await engineRef.current.loadPlayers(
          { type: 'bot', bot: currentWhiteBot },
          { type: 'bot', bot: currentBlackBot },
        );
        await engineRef.current.play();

        const state = engineRef.current.getState();
        if (state.status !== 'finished') {
          throw new Error('Match aborted');
        }

        const winnerColor = getWinnerColor(state.result);
        const reason = getGameWinReason(state.result);

        if (gameNumber === 1) {
          if (winnerColor === 'w') {
            whiteBotWins++;
            gameResults.push({ winner: whiteBot, loser: blackBot, reason });
            if (whiteBotWins === 2) {
              return { winner: whiteBot, loser: blackBot, gameResults };
            }
          } else if (winnerColor === 'b') {
            blackBotWins++;
            gameResults.push({ winner: blackBot, loser: whiteBot, reason });
            if (blackBotWins === 2) {
              return { winner: blackBot, loser: whiteBot, gameResults };
            }
          }
        } else if (gameNumber === 2) {
          if (winnerColor === 'w') {
            whiteBotWins++;
            game2Winner = whiteBot;
            game2Loser = blackBot;
            gameResults.push({ winner: whiteBot, loser: blackBot, reason });
            if (whiteBotWins === 2) {
              return { winner: whiteBot, loser: blackBot, gameResults };
            }
          } else if (winnerColor === 'b') {
            blackBotWins++;
            game2Winner = blackBot;
            game2Loser = whiteBot;
            gameResults.push({ winner: blackBot, loser: whiteBot, reason });
            if (blackBotWins === 2) {
              return { winner: blackBot, loser: whiteBot, gameResults };
            }
          }
        } else if (gameNumber === 3) {
          // Game 3 determines the final winner
          if (winnerColor === 'w') {
            gameResults.push({ winner: currentWhiteBot, loser: currentBlackBot, reason });
            return { winner: currentWhiteBot, loser: currentBlackBot, gameResults };
          } else if (winnerColor === 'b') {
            gameResults.push({ winner: currentBlackBot, loser: currentWhiteBot, reason });
            return { winner: currentBlackBot, loser: currentWhiteBot, gameResults };
          } else {
            // Draw in game 3 - the winner from game 2 advances
            gameResults.push({ winner: game2Winner || whiteBot, loser: game2Loser || blackBot, reason });
            if (game2Winner === whiteBot) {
              return { winner: whiteBot, loser: blackBot, gameResults };
            } else {
              return { winner: blackBot, loser: whiteBot, gameResults };
            }
          }
        }

        gameNumber++;
      }

      // Fallback (should not reach here)
      throw new Error('Best-of-3 match completed without winner');
    } finally {
      // Restore original time limit
      engineRef.current.setTimeLimit(originalTimeLimit);
    }
  };

  const handleStartTournament = async () => {
    if (tournamentRunning || bots.length < 2) return;
    setError(null);
    setTournamentRunning(true);
    try {
      const shuffled = shuffleBots(bots);
      const totalRounds = Math.ceil(Math.log2(shuffled.length));
      let rounds = [buildRound(shuffled, 0, totalRounds)];
      let tournamentState: TournamentState = {
        status: 'running',
        rounds,
        currentMatchId: null,
        champion: null,
        runnerUp: null,
        thirdPlace: null,
        headToHead: {},
        tournamentTimeLimitMs: tournamentTimeLimitMs,
      };

      const commitTournament = () => {
        setTournament({
          ...tournamentState,
          rounds: tournamentState.rounds.map((round) => ({
            ...round,
            matches: round.matches.map((match) => ({ ...match })),
          })),
        });
      };

      commitTournament();

      const updateMatch = (
        roundIndex: number,
        matchIndex: number,
        patch: Partial<TournamentState['rounds'][number]['matches'][number]>,
      ) => {
        const updatedRounds = tournamentState.rounds.map((round, rIndex) => {
          if (rIndex !== roundIndex) return round;
          return {
            ...round,
            matches: round.matches.map((match, mIndex) => {
              if (mIndex !== matchIndex) return match;
              return { ...match, ...patch };
            }),
          };
        });
        tournamentState = { ...tournamentState, rounds: updatedRounds };
        commitTournament();
      };

      // Helper to track head-to-head record between two bots
      const trackHeadToHead = (winner: BotInfo, loser: BotInfo) => {
        const names = [winner.username, loser.username].sort();
        const key = names.join('-vs-');
        if (!tournamentState.headToHead[key]) {
          tournamentState.headToHead[key] = { wins: 0, losses: 0 };
        }
        // Increment based on who won
        if (winner.username === names[0]) {
          tournamentState.headToHead[key].wins++;
        } else {
          tournamentState.headToHead[key].losses++;
        }
      };

      let semifinalLosers: BotInfo[] = [];
      let champion: BotInfo | null = null;
      let runnerUp: BotInfo | null = null;
      let thirdPlace: BotInfo | null = null;

      let roundIndex = 0;
      while (roundIndex < tournamentState.rounds.length) {
        const currentRound = tournamentState.rounds[roundIndex];
        const winners: BotInfo[] = [];

        for (let matchIndex = 0; matchIndex < currentRound.matches.length; matchIndex += 1) {
          const match = currentRound.matches[matchIndex];
          const whiteBot = match.whiteBot;
          const blackBot = match.blackBot;

          if (whiteBot && !blackBot) {
            updateMatch(roundIndex, matchIndex, {
              status: 'bye',
              winner: whiteBot,
              loser: null,
            });
            winners.push(whiteBot);
            continue;
          }

          if (!whiteBot || !blackBot) {
            continue;
          }

          tournamentState = { ...tournamentState, currentMatchId: match.id };
          commitTournament();
          updateMatch(roundIndex, matchIndex, { status: 'running' });

          const result = await playBotMatch(whiteBot, blackBot, tournamentTimeLimitMs);
          updateMatch(roundIndex, matchIndex, {
            status: 'finished',
            winner: result.winner,
            loser: result.loser,
            gameResults: result.gameResults,
          });

          // Track head-to-head record
          trackHeadToHead(result.winner, result.loser);

          winners.push(result.winner);

          if (currentRound.title === 'Semifinals') {
            semifinalLosers.push(result.loser);
          }

          if (currentRound.title === 'Final') {
            champion = result.winner;
            runnerUp = result.loser;
          }
        }

        if (winners.length <= 1) {
          champion = champion ?? winners[0] ?? null;
          break;
        }

        const nextRound = buildRound(shuffleBots(winners), roundIndex + 1, totalRounds);
        tournamentState = {
          ...tournamentState,
          rounds: [...tournamentState.rounds, nextRound],
        };
        commitTournament();

        roundIndex += 1;
      }

      if (semifinalLosers.length === 2) {
        const thirdPlaceRound = {
          title: 'Third Place',
          matches: [
            {
              id: 'third-place',
              roundIndex: totalRounds,
              matchIndex: 0,
              whiteBot: semifinalLosers[0],
              blackBot: semifinalLosers[1],              gameResults: [],              status: 'pending' as const,
              winner: null,
              loser: null,
            },
          ],
        };

        tournamentState = {
          ...tournamentState,
          rounds: [...tournamentState.rounds, thirdPlaceRound],
        };
        commitTournament();

        const result = await playBotMatch(semifinalLosers[0], semifinalLosers[1], tournamentTimeLimitMs);
        thirdPlace = result.winner;

        // Track head-to-head record
        trackHeadToHead(result.winner, result.loser);

        updateMatch(tournamentState.rounds.length - 1, 0, {
          status: 'finished',
          winner: result.winner,
          loser: result.loser,
          gameResults: result.gameResults,
        });
      }

      tournamentState = {
        ...tournamentState,
        status: 'finished',
        champion: champion ?? null,
        runnerUp: runnerUp ?? null,
        thirdPlace: thirdPlace ?? null,
        currentMatchId: null,
      };
      setTournament(tournamentState);
      setTournamentRunning(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Tournament failed: ${msg}`);
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
  const currentMatch = tournament?.currentMatchId
    ? tournament.rounds
      .flatMap((round) => round.matches)
      .find((match) => match.id === tournament.currentMatchId) ?? null
    : null;

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
          Single-elimination, randomized bracket. Best-of-3 series: first to 2 wins
          advances. Game 3 (if tied): loser of game 2 plays as white.
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

        {currentMatch && (
          <div className="tournament-status">
            Now playing: {currentMatch.whiteBot?.username} vs {currentMatch.blackBot?.username}
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
