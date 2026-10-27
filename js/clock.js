// Single responsibility: chess clock timing (presets, increment, flag on timeout). Knows nothing about chess rules.

export const PRESETS = {
  '1+0': { base: 60_000, inc: 0 },
  '3+2': { base: 180_000, inc: 2_000 },
  '5+0': { base: 300_000, inc: 0 },
  '10+0': { base: 600_000, inc: 0 },
  untimed: null,
};

const other = (color) => (color === 'w' ? 'b' : 'w');

export function createClock({ onFlag = () => {}, onTick = () => {} } = {}) {
  let base = null;
  let inc = 0;
  let rem = { w: 0, b: 0 };
  let active = null; // side whose clock is currently running
  let running = false;
  let last = 0;
  let timer = null;

  function settle() {
    if (!running || !active) return;
    const now = Date.now();
    rem[active] -= now - last;
    last = now;
    if (rem[active] <= 0) {
      rem[active] = 0;
      running = false;
      onFlag(active);
    }
  }

  function snapshot() {
    settle();
    return base == null ? null : { w: rem.w, b: rem.b, active, running };
  }

  function notify() {
    onTick(snapshot());
  }

  function ensureTimer() {
    if (!timer) {
      timer = setInterval(() => {
        settle();
        if (!running) stopTimer();
        notify();
      }, 100);
    }
  }

  function stopTimer() {
    clearInterval(timer);
    timer = null;
  }

  function configure(preset) {
    base = preset ? preset.base : null;
    inc = preset ? preset.inc : 0;
    rem = { w: base ?? 0, b: base ?? 0 };
    active = null;
    running = false;
    stopTimer();
    notify();
  }

  /** Starts (or re-points) the running clock at the side to move. */
  function start(color) {
    if (base == null) return;
    settle();
    active = color;
    running = true;
    last = Date.now();
    ensureTimer();
    notify();
  }

  /** Called when a side completes a move: adds the increment and passes the turn. */
  function moveMade(mover) {
    if (base == null) return;
    settle();
    if (active === mover) rem[mover] += inc;
    active = other(mover);
    running = true;
    last = Date.now();
    ensureTimer();
    notify();
  }

  function pause() {
    settle();
    running = false;
    stopTimer();
    notify();
  }

  function restore(snap) {
    if (!snap || base == null) return;
    rem = { w: snap.w, b: snap.b };
    active = snap.active;
    running = false;
    stopTimer();
  }

  return { configure, start, moveMade, pause, restore, snapshot };
}