// Single responsibility: draw the board and turn pointer input into move requests.
// It never decides legality: the controller supplies the legal targets for a square.

const FILES = 'abcdefgh';
// Filled glyphs for both sides. Colour comes from CSS, so white and black pieces look distinct.
const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const PROMOTION_TYPES = ['q', 'r', 'b', 'n'];
const DRAG_THRESHOLD_PX = 6;

/** Markup for one piece in the chosen set: 'unicode' glyphs or 'alpha' SVG discs. */
export function pieceMarkup(color, type, set = 'unicode') {
  if (set === 'alpha') {
    const fill = color === 'w' ? '#f5f5f5' : '#2b2b2b';
    const ink = color === 'w' ? '#2b2b2b' : '#f5f5f5';
    return (
      '<svg class="piece-svg" viewBox="0 0 45 45" aria-hidden="true">' +
      `<circle cx="22.5" cy="22.5" r="18" fill="${fill}" stroke="#111" stroke-width="1.5"/>` +
      '<text x="22.5" y="30" text-anchor="middle" font-size="20" font-weight="700" ' +
      `font-family="Arial, sans-serif" fill="${ink}">${type.toUpperCase()}</text></svg>`
    );
  }
  // SVG text with explicit fill/stroke: system fonts and emoji styling cannot recolour it.
  // U+FE0E forces the text (non-emoji) form of the glyph.
  const fill = color === 'w' ? '#ffffff' : '#000000';
  const stroke = color === 'w' ? '#000000' : '#d0d0d0';
  return (
    `<svg class="piece-svg ${color}" viewBox="0 0 45 45" aria-hidden="true">` +
    '<text x="22.5" y="36" text-anchor="middle" font-size="40" ' +
    'font-family="\'Segoe UI Symbol\', \'DejaVu Sans\', \'Noto Sans Symbols 2\', sans-serif" ' +
    `fill="${fill}" stroke="${stroke}" stroke-width="1.6" paint-order="stroke">${GLYPHS[type]}\uFE0E</text></svg>`
  );
}

const squareName = (fileIdx, rankIdx) => FILES[fileIdx] + (rankIdx + 1);

function squareAt(x, y) {
  const el = document.elementFromPoint(x, y)?.closest('.sq');
  return el ? el.dataset.sq : null;
}

function coord(kind, text) {
  const span = document.createElement('span');
  span.className = `coord ${kind}`;
  span.textContent = text;
  return span;
}

export function createBoard(container, handlers) {
  let view = null;
  let flipped = false;
  let selected = null;
  let targets = [];
  let drag = null;

  container.addEventListener('pointerdown', onPointerDown);

  function render(next) {
    if (next) view = next;
    if (!view) return;
    if (!view.interactive || (selected && !view.pieces[selected])) selected = null;
    targets = selected ? handlers.targetsFor(selected) : [];
    const targetSet = new Set(targets.map((t) => t.to));
    const captureSet = new Set(targets.filter((t) => t.capture).map((t) => t.to));
    container.className = `board theme-${view.theme}`;
    container.replaceChildren();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const fileIdx = flipped ? 7 - col : col;
        const rankIdx = flipped ? row : 7 - row;
        container.appendChild(buildSquare({ row, col, fileIdx, rankIdx }, targetSet, captureSet));
      }
    }
  }

  function buildSquare({ row, col, fileIdx, rankIdx }, targetSet, captureSet) {
    const sq = squareName(fileIdx, rankIdx);
    const el = document.createElement('div');
    el.className = `sq ${(fileIdx + rankIdx) % 2 ? 'light' : 'dark'}`;
    el.dataset.sq = sq;
    const { lastMove, checkSq, hint } = view;
    if (lastMove && (sq === lastMove.from || sq === lastMove.to)) el.classList.add('last');
    if (hint && (sq === hint.from || sq === hint.to)) el.classList.add('hint');
    if (sq === checkSq) el.classList.add('check');
    if (sq === selected) el.classList.add('selected');
    const piece = view.pieces[sq];
    if (piece) {
      el.dataset.color = piece.color;
      el.innerHTML = pieceMarkup(piece.color, piece.type, view.pieceSet);
    }
    if (targetSet.has(sq)) {
      const mark = document.createElement('span');
      mark.className = `mark ${captureSet.has(sq) ? 'ring' : 'dot'}`;
      el.appendChild(mark);
    }
    if (col === 0) el.appendChild(coord('rank', String(rankIdx + 1)));
    if (row === 7) el.appendChild(coord('file', FILES[fileIdx]));
    return el;
  }

  function onPointerDown(e) {
    if (e.button !== 0 || !view?.interactive) return;
    const el = e.target.closest('.sq');
    if (!el) return;
    const sq = el.dataset.sq;
    if (selected && targets.some((t) => t.to === sq)) {
      attempt(selected, sq);
      return;
    }
    if (el.dataset.color !== view.turn) {
      selected = null;
      render();
      return;
    }
    selected = sq;
    drag = { from: sq, x: e.clientX, y: e.clientY, ghost: null };
    render();
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
  }

  function onDragMove(e) {
    if (!drag) return;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_THRESHOLD_PX) return;
      drag.ghost = makeGhost(drag.from);
    }
    const half = drag.ghost.offsetWidth / 2;
    drag.ghost.style.transform = `translate(${e.clientX - half}px, ${e.clientY - half}px)`;
  }

  function onDragEnd(e) {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    const d = drag;
    drag = null;
    if (!d?.ghost) return; // plain click: the piece stays selected
    d.ghost.remove();
    const to = squareAt(e.clientX, e.clientY);
    if (to && to !== d.from && targets.some((t) => t.to === to)) attempt(d.from, to);
    else render(); // illegal drop: the piece never left its square, so just redraw
  }

  function makeGhost(sq) {
    const piece = view.pieces[sq];
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    const size = container.clientWidth / 8;
    ghost.style.width = ghost.style.height = `${size}px`;
    ghost.innerHTML = pieceMarkup(piece.color, piece.type, view.pieceSet);
    document.body.appendChild(ghost);
    container.querySelector(`[data-sq="${sq}"]`)?.classList.add('dragging');
    return ghost;
  }

  function attempt(from, to) {
    const options = targets.filter((t) => t.to === to);
    if (!options.length) return render();
    if (options[0].promotion) return showPromotion(from, to);
    selected = null;
    targets = [];
    handlers.onMove(from, to);
  }

  function showPromotion(from, to) {
    const overlay = document.createElement('div');
    overlay.className = 'promo-overlay';
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        render();
      }
    });
    for (const type of PROMOTION_TYPES) {
      const btn = document.createElement('button');
      btn.className = 'promo-choice';
      btn.setAttribute('aria-label', `Promote to ${type}`);
      btn.innerHTML = pieceMarkup(view.turn, type, view.pieceSet);
      btn.addEventListener('click', () => {
        selected = null;
        targets = [];
        handlers.onMove(from, to, type);
      });
      overlay.appendChild(btn);
    }
    container.appendChild(overlay);
  }

  return {
    render,
    flip() {
      flipped = !flipped;
      render();
    },
    isFlipped: () => flipped,
  };
}

let audioCtx = null;

/** Short click via WebAudio. Silently does nothing where audio is unavailable. */
export function playMoveSound() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const t = audioCtx.currentTime;
    osc.frequency.value = 520;
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  } catch {
    /* audio unavailable */
  }
}
