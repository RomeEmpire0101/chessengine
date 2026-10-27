// Single responsibility: side panels (move list, action buttons, clocks, game-over card, arrow-key stepping). Emits intents only; holds no game state.
import { PRESETS } from './clock.js';

const REASON_TEXT = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  agreement: 'Draw by agreement',
  repetition: 'Threefold repetition',
  fifty: 'Fifty-move rule',
  insufficient: 'Insufficient material',
  timeout: 'Timeout',
  resignation: 'Resignation',
};

const other = (c) => (c === 'w' ? 'b' : 'w');

function headline(result, playerColor) {
  if (!result.winner) return 'Draw';
  return result.winner === playerColor ? 'You won' : 'Stockfish won';
}

function statusText({ result, moves, cursor, turn, playerColor }) {
  if (result) return headline(result, playerColor);
  if (cursor < moves.length) return 'Reviewing history. Press → to step forward.';
  return turn === playerColor ? 'Your move' : 'Stockfish is thinking…';
}

function formatClock(ms) {
  if (ms < 10_000) return (ms / 1000).toFixed(1);
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function newGameMarkup() {
  const presets = Object.keys(PRESETS)
    .map((k) => `<option value="${k}"${k === '10+0' ? ' selected' : ''}>${k === 'untimed' ? 'Untimed' : k}</option>`)
    .join('');
  return `<form class="new-game">
    <h2>New game</h2>
    <label>Play as
      <select name="color">
        <option value="w">White</option>
        <option value="b">Black</option>
        <option value="random" selected>Random</option>
      </select>
    </label>
    <label>Clock <select name="preset">${presets}</select></label>
    <button type="submit">Start</button>
  </form>`;
}

const CONTROLS_MARKUP = `
  <div class="status-line"></div>
  <div class="button-row">
    <button data-act="undo" title="Undo your move and the engine's reply">Undo</button>
    <button data-act="redo">Redo</button>
    <button data-act="hint">Hint</button>
    <button data-act="flip">Flip board</button>
  </div>
  <div class="button-row">
    <button data-act="draw">Offer draw</button>
    <button data-act="resign" class="danger">Resign</button>
    <button data-act="copy">Copy PGN</button>
    <button data-act="fen">Paste FEN</button>
  </div>`;

export function createPanels(els, handlers) {
  let lastView = null;
  let overlayKey = null;
  let dismissedKey = null;
  let toastTimer = null;

  els.controls.innerHTML = CONTROLS_MARKUP;
  els.newGame.innerHTML = newGameMarkup();
  const statusEl = els.controls.querySelector('.status-line');
  const form = els.newGame.querySelector('form');

  const actions = {
    undo: () => handlers.onUndo(),
    redo: () => handlers.onRedo(),
    hint: () => handlers.onHint(),
    flip: () => handlers.onFlip(),
    draw: () => handlers.onDraw(),
    resign: () => handlers.onResign(),
    copy: () => handlers.onCopyPgn(),
    fen: pasteFen,
  };

  els.controls.addEventListener('click', (e) => {
    const act = e.target.closest('button[data-act]')?.dataset.act;
    actions[act]?.();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handlers.onNewGame(formValues());
  });
  els.moves.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-ply]');
    if (btn) handlers.onGoTo(Number(btn.dataset.ply));
  });
  els.gameOver.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'new') handlers.onNewGame(formValues());
    if (act === 'review') {
      dismissedKey = overlayKey;
      els.gameOver.classList.add('hidden');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, select, textarea')) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      handlers.onStep(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      handlers.onStep(1);
    }
  });

  function formValues() {
    const data = new FormData(form);
    return { color: data.get('color'), preset: data.get('preset') };
  }

  function pasteFen() {
    const text = window.prompt('Paste a FEN position:');
    if (text && text.trim()) handlers.onLoadFen(text.trim());
  }

  function setDisabled(act, flag) {
    els.controls.querySelector(`[data-act="${act}"]`).disabled = flag;
  }

  function render(view) {
    lastView = view;
    const total = view.moves.length;
    const frozen = Boolean(view.result) || view.cursor !== total;
    setDisabled('undo', view.cursor === 0);
    setDisabled('redo', view.cursor >= total);
    setDisabled('draw', frozen);
    setDisabled('resign', frozen);
    setDisabled('hint', frozen || view.turn !== view.playerColor);
    statusEl.textContent = statusText(view);
    renderMoves(view);
    renderGameOver(view);
  }

  function renderMoves({ moves, cursor }) {
    const rows = [
      `<li class="start"><button class="ply${cursor === 0 ? ' current' : ''}" data-ply="0">Start</button></li>`,
    ];
    for (let i = 0; i < moves.length; i += 2) {
      const white = ply(moves, cursor, i);
      const black = i + 1 < moves.length ? ply(moves, cursor, i + 1) : '<span></span>';
      rows.push(`<li class="pair"><span class="num">${i / 2 + 1}.</span>${white}${black}</li>`);
    }
    els.moves.innerHTML = rows.join('');
    els.moves.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }

  function ply(moves, cursor, i) {
    const n = i + 1;
    return `<button class="ply${cursor === n ? ' current' : ''}" data-ply="${n}">${moves[i]}</button>`;
  }

  function renderGameOver({ result, playerColor, moves }) {
    if (!result) {
      els.gameOver.classList.add('hidden');
      return;
    }
    overlayKey = JSON.stringify(result) + moves.length;
    if (overlayKey === dismissedKey) {
      els.gameOver.classList.add('hidden');
      return;
    }
    els.gameOver.innerHTML = `
      <h2>${headline(result, playerColor)}</h2>
      <p>${REASON_TEXT[result.reason] ?? result.reason}</p>
      <div class="button-row" style="justify-content:center">
        <button data-act="new">New game</button>
        <button data-act="review">Review</button>
      </div>`;
    els.gameOver.classList.remove('hidden');
  }

  function renderClocks(snap, playerColor) {
    if (!snap) {
      els.clocks.classList.add('hidden');
      return;
    }
    els.clocks.classList.remove('hidden');
    const cell = (color) => {
      const name = color === playerColor ? 'You' : 'Stockfish';
      const cls = snap.active === color && snap.running ? 'clock active' : 'clock';
      return `<div class="${cls}"><span>${name}</span><strong>${formatClock(snap[color])}</strong></div>`;
    };
    els.clocks.innerHTML = cell(other(playerColor)) + cell(playerColor);
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  return { render, renderClocks, toast };
}