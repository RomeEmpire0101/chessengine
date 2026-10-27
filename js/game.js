// Single responsibility: game controller. Owns the game state (start FEN, moves, cursor, result) and connects rules, board, engine, clock and panels.
import * as rules from './rules.js';
import * as engine from './engine.js';
import { createClock, PRESETS } from './clock.js';
import { playMoveSound } from './board.js';

const STORAGE_KEY = 'exy-chess.game';
const ENGINE_DELAY_MS = 450;
const EVAL_MOVETIME_MS = 400;
const HINT_MOVETIME_MS = 800;
const DRAW_TOLERANCE_CP = 50;

const other = (color) => (color === 'w' ? 'b' : 'w');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function freshState(overrides = {}) {
  return {
    startFen: rules.START_FEN, moves: [], cursor: 0, playerColor: 'w',
    preset: '10+0', result: null, clock: null, ...overrides,
  };
}

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!raw || typeof raw.startFen !== 'string' || !rules.createPosition(raw.startFen) || !Array.isArray(raw.moves)) {
      return null;
    }
    return { ...freshState(), ...raw, cursor: clamp(Number(raw.cursor) || 0, 0, raw.moves.length) };
  } catch {
    return null;
  }
}

function resolveColor(color) {
  if (color !== 'random') return color;
  return Math.random() < 0.5 ? 'w' : 'b';
}

function resultCode(result) {
  if (!result) return '*';
  if (!result.winner) return '1/2-1/2';
  return result.winner === 'w' ? '1-0' : '0-1';
}

export function createGame({ board, panels, evalBar, getSettings }) {
  let s = loadState() ?? freshState();
  let pos = null;
  let token = 0; // bumps on every position change; late async results compare against it
  let hintMove = null;
  const clock = createClock({
    onFlag: (color) => endGame({ winner: other(color), reason: 'timeout' }),
    onTick: (snap) => panels.renderClocks(snap, s.playerColor),
  });

  const live = () => !s.result && s.cursor === s.moves.length;
  const canPlay = () => live() && pos.turn() === s.playerColor;

  function save() {
    s.clock = clock.snapshot();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable: the game still works, it just does not persist */
    }
  }

  function paint() {
    const { theme, pieceSet } = getSettings();
    board.render({
      pieces: rules.pieceMap(pos),
      turn: pos.turn(),
      lastMove: rules.lastMove(pos),
      checkSq: rules.checkSquare(pos),
      hint: hintMove,
      interactive: canPlay(),
      theme,
      pieceSet,
    });
    panels.render({
      moves: s.moves, cursor: s.cursor, result: s.result,
      playerColor: s.playerColor, turn: pos.turn(),
    });
    panels.renderClocks(clock.snapshot(), s.playerColor);
  }

  /** Rebuilds the position from the move list, applies end-of-game state, clocks, then paints. */
  function refresh() {
    pos = rules.replay(s.startFen, s.moves.slice(0, s.cursor)) ?? rules.createPosition(s.startFen);
    if (!s.result && live()) {
      const st = rules.gameStatus(pos);
      if (st.over) s.result = { winner: st.winner, reason: st.reason };
    }
    if (s.result) clock.pause();
    else if (live()) clock.start(pos.turn());
    else clock.pause();
    paint();
    save();
  }

  /** After any position change: refresh, then either evaluate (player's turn) or let the engine move. */
  function advance() {
    refresh();
    if (!live() || s.result) return;
    if (pos.turn() === s.playerColor) refreshEval(token);
    else engineTurn(token);
  }

  async function refreshEval(my) {
    if (!getSettings().evalBar) return;
    const res = await engine.analyse(pos.fen(), { movetime: EVAL_MOVETIME_MS });
    if (res && my === token) evalBar.update(res.score);
  }

  async function engineTurn(my) {
    await delay(ENGINE_DELAY_MS);
    if (my !== token) return;
    const { moveTimeMs, depth } = getSettings();
    try {
      const res = await engine.analyse(pos.fen(), { movetime: moveTimeMs, depth });
      if (!res?.bestMove || my !== token) return;
      const mover = pos.turn();
      const move = rules.playMove(pos, res.bestMove.from, res.bestMove.to, res.bestMove.promotion);
      if (move) commit(move.san, mover);
    } catch (err) {
      panels.toast(`Engine error: ${err.message}`);
    }
  }

  /** Appends a move. Playing from mid-history discards the redo line. */
  function commit(san, mover) {
    token++;
    hintMove = null;
    s.moves = s.moves.slice(0, s.cursor).concat(san);
    s.cursor = s.moves.length;
    s.result = null;
    clock.moveMade(mover);
    if (getSettings().sound) playMoveSound();
    advance();
  }

  function endGame(result) {
    token++;
    hintMove = null;
    engine.stop();
    s.result = result;
    refresh();
  }

  function navigate(target) {
    token++;
    hintMove = null;
    engine.stop();
    s.cursor = target;
    s.result = null;
    advance();
  }

  function playerMove(from, to, promotion) {
    if (!canPlay()) return paint();
    const mover = pos.turn();
    const move = rules.playMove(pos, from, to, promotion);
    if (!move) return paint();
    commit(move.san, mover);
  }

  function targetsFor(sq) {
    return rules.legalMovesFrom(pos, sq).map((m) => ({
      to: m.to, capture: Boolean(m.captured), promotion: Boolean(m.promotion),
    }));
  }

  // One ply back when it is the engine's move, two plies (engine reply and player move) when it is the player's.
  function undo() {
    if (s.cursor === 0) return;
    navigate(Math.max(0, s.cursor - (pos.turn() === s.playerColor ? 2 : 1)));
  }

  function redo() {
    if (s.cursor >= s.moves.length) return;
    navigate(Math.min(s.moves.length, s.cursor + (pos.turn() === s.playerColor ? 2 : 1)));
  }

  function goTo(ply) {
    if (ply !== s.cursor) navigate(clamp(ply, 0, s.moves.length));
  }

  function stepBy(delta) {
    goTo(s.cursor + delta);
  }

  function newGame({ color = 'random', preset = s.preset, startFen = rules.START_FEN } = {}) {
    token++;
    hintMove = null;
    engine.stop();
    s = freshState({ startFen, playerColor: resolveColor(color), preset });
    clock.configure(PRESETS[preset] ?? null);
    advance();
  }

  function loadFen(fen) {
    if (!rules.createPosition(fen)) {
      panels.toast('That FEN is not valid.');
      return;
    }
    newGame({ color: s.playerColor, preset: s.preset, startFen: fen });
  }

  function resign() {
    if (!live()) return;
    endGame({ winner: other(s.playerColor), reason: 'resignation' });
  }

  async function offerDraw() {
    if (!live()) return;
    const my = token;
    const res = await engine.analyse(pos.fen(), { movetime: HINT_MOVETIME_MS });
    if (!res || my !== token) return;
    const sign = s.playerColor === 'w' ? 1 : -1;
    // The engine accepts when it is not clearly better (≤ +0.5 pawn for it), or when it is being mated.
    const accept = res.score.type === 'cp'
      ? -sign * res.score.value <= DRAW_TOLERANCE_CP
      : sign * res.score.value > 0;
    if (accept) endGame({ winner: null, reason: 'agreement' });
    else panels.toast('Stockfish declined the draw.');
  }

  async function hint() {
    if (!canPlay()) return panels.toast('Hints are available on your turn.');
    const my = token;
    const res = await engine.analyse(pos.fen(), { movetime: HINT_MOVETIME_MS });
    if (!res?.bestMove || my !== token) return;
    hintMove = { from: res.bestMove.from, to: res.bestMove.to };
    paint();
  }

  async function copyPgn() {
    const text = rules.toPgn(s.startFen, s.moves, {
      Event: 'Casual game',
      Site: 'Local',
      Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      White: s.playerColor === 'w' ? 'You' : 'Stockfish',
      Black: s.playerColor === 'b' ? 'You' : 'Stockfish',
      Result: resultCode(s.result),
    });
    try {
      await navigator.clipboard.writeText(text);
      panels.toast('PGN copied to clipboard.');
    } catch {
      panels.toast('The browser blocked clipboard access.');
    }
  }

  function start() {
    clock.configure(PRESETS[s.preset] ?? null);
    clock.restore(s.clock);
    window.addEventListener('pagehide', save);
    advance();
  }

  return {
    start, newGame, playerMove, targetsFor, undo, redo, goTo, stepBy,
    resign, offerDraw, hint, loadFen, copyPgn,
    repaint: () => pos && paint(),
  };
}