// Single responsibility: every chess rule, delegated to chess.js. The UI never evaluates rules itself.
import { Chess } from '../vendor/chess.js/chess.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const drawStatus = (reason) => ({ over: true, winner: null, reason });

/** A chess.js position for a FEN, or null when the FEN is invalid. */
export function createPosition(fen = START_FEN) {
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

/** Rebuilds a position by replaying SAN moves, so repetition history is kept. */
export function replay(startFen, sanMoves) {
  const pos = createPosition(startFen);
  if (!pos) return null;
  for (const san of sanMoves) {
    if (!tryMove(pos, san)) return null;
  }
  return pos;
}

function tryMove(pos, input) {
  try {
    return pos.move(input);
  } catch {
    return null;
  }
}

/** Legal moves for the piece on a square, as verbose chess.js move objects. */
export function legalMovesFrom(pos, square) {
  return pos.moves({ square, verbose: true });
}

/** Legal move objects from→to. Several are returned when the move is a promotion. */
export function movesBetween(pos, from, to) {
  return legalMovesFrom(pos, from).filter((m) => m.to === to);
}

/** Plays from→to if legal. Promotions default to a queen. Returns the chess.js move or null. */
export function playMove(pos, from, to, promotion = 'q') {
  const options = movesBetween(pos, from, to);
  if (!options.length) return null;
  const promo = options[0].promotion ? promotion : undefined;
  return tryMove(pos, { from, to, promotion: promo });
}

/** Game status for the side to move: checkmate, stalemate, insufficient, repetition, fifty-move. */
export function gameStatus(pos) {
  if (pos.isCheckmate()) return { over: true, winner: pos.turn() === 'w' ? 'b' : 'w', reason: 'checkmate' };
  if (pos.isStalemate()) return drawStatus('stalemate');
  if (pos.isInsufficientMaterial()) return drawStatus('insufficient');
  if (pos.isThreefoldRepetition()) return drawStatus('repetition');
  if (Number(pos.fen().split(' ')[4]) >= 100) return drawStatus('fifty');
  return { over: false };
}

/** Map of square → { color, type } for rendering. */
export function pieceMap(pos) {
  const map = {};
  for (const row of pos.board()) {
    for (const p of row) {
      if (p) map[p.square] = { color: p.color, type: p.type };
    }
  }
  return map;
}

/** Square of the side-to-move's king when it is in check, otherwise null. */
export function checkSquare(pos) {
  if (!pos.inCheck()) return null;
  const map = pieceMap(pos);
  return Object.keys(map).find((sq) => map[sq].type === 'k' && map[sq].color === pos.turn()) ?? null;
}

/** The most recent move as { from, to, san }, or null at the start. */
export function lastMove(pos) {
  const history = pos.history({ verbose: true });
  const m = history[history.length - 1];
  return m ? { from: m.from, to: m.to, san: m.san } : null;
}

/** PGN for a line of SAN moves from a start FEN. */
export function toPgn(startFen, sanMoves, headers = {}) {
  const pos = replay(startFen, sanMoves);
  if (!pos) return '';
  const all = startFen === START_FEN ? headers : { ...headers, FEN: startFen, SetUp: '1' };
  for (const [key, value] of Object.entries(all)) pos.setHeader(key, value);
  return pos.pgn();
}

/** Parses PGN text into { startFen, moves } (SAN), or null when it cannot be parsed. */
export function fromPgn(text) {
  const pos = createPosition();
  try {
    pos.loadPgn(text);
  } catch {
    return null;
  }
  return { startFen: pos.header().FEN ?? START_FEN, moves: pos.history() };
}
