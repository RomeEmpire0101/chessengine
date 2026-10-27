// Single responsibility: Stockfish adapter. Owns the Web Worker and the UCI protocol.
// The rest of the app uses only the exports here, never the raw worker messages.

// Single-threaded "lite" build: needs no SharedArrayBuffer and no COOP/COEP headers.
const DEFAULT_WORKER_URL = './vendor/stockfish/stockfish-19-lite-single.js';
const INIT_TIMEOUT_MS = 20000;
const WATCHDOG_SLACK_MS = 4000;

let worker = null;
let initPromise = null;
let skill = 20;
let eloCap = null;
let depth = null;
let moveTime = 1000;
let generation = 0;               // bumped by stop(); queued searches from older generations are dropped
let chain = Promise.resolve();    // searches run one at a time
let search = null;                // { turn, info, resolve, watchdog } while a search is running
const waiters = [];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(n)));
const send = (cmd) => worker?.postMessage(cmd);

function waitForLine(match) {
  return new Promise((resolve, reject) => {
    const waiter = { match, resolve };
    waiters.push(waiter);
    setTimeout(() => {
      const i = waiters.indexOf(waiter);
      if (i >= 0) {
        waiters.splice(i, 1);
        reject(new Error('Stockfish did not respond in time'));
      }
    }, INIT_TIMEOUT_MS);
  });
}

function handleLine(line) {
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (waiters[i].match(line)) {
      waiters[i].resolve(line);
      waiters.splice(i, 1);
    }
  }
  if (!search) return;
  if (line.startsWith('info') && line.includes(' score ')) {
    search.info = parseInfo(line, search.turn) ?? search.info;
  } else if (line.startsWith('bestmove')) {
    finish(line);
  }
}

/** Reads depth and score from an info line. Scores are converted to White's perspective. */
function parseInfo(line, turn) {
  const t = line.split(' ');
  const s = t.indexOf('score');
  if (s < 0) return null;
  const sign = turn === 'b' ? -1 : 1;
  const d = t.indexOf('depth');
  return {
    depth: d >= 0 ? Number(t[d + 1]) : 0,
    score: { type: t[s + 1] === 'mate' ? 'mate' : 'cp', value: Number(t[s + 2]) * sign },
  };
}

function parseUci(token) {
  if (!token || token === '(none)') return null;
  return { from: token.slice(0, 2), to: token.slice(2, 4), promotion: token[4] };
}

function finish(line) {
  const s = search;
  search = null;
  clearTimeout(s.watchdog);
  s.resolve({
    bestMove: parseUci(line.split(' ')[1]),
    score: s.info?.score ?? { type: 'cp', value: 0 },
    depth: s.info?.depth ?? 0,
  });
}

function runSearch(fen, opts) {
  return new Promise((resolve) => {
    const turn = fen.split(' ')[1];
    const d = opts.depth ?? depth;
    const ms = opts.movetime ?? moveTime;
    const watchdog = d ? null : setTimeout(() => send('stop'), ms + WATCHDOG_SLACK_MS);
    search = { turn, info: null, resolve, watchdog };
    send(`position fen ${fen}`);
    send(d ? `go depth ${d}` : `go movetime ${ms}`);
  });
}

function applyOptions() {
  send(`setoption name Skill Level value ${skill}`);
  send(`setoption name UCI_LimitStrength value ${eloCap != null}`);
  if (eloCap != null) send(`setoption name UCI_Elo value ${eloCap}`);
}

/** Starts the worker and resolves once Stockfish reports uciok and readyok. */
export function init(url = DEFAULT_WORKER_URL) {
  if (!initPromise) {
    initPromise = (async () => {
      worker = new Worker(url);
      worker.onmessage = (e) => handleLine(String(e.data));
      worker.onerror = (e) => console.error('Stockfish worker error:', e.message);
      send('uci');
      await waitForLine((line) => line === 'uciok');
      applyOptions();
      send('isready');
      await waitForLine((line) => line === 'readyok');
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

/** Skill level 0–20. */
export function setSkillLevel(level) {
  skill = clamp(level, 0, 20);
  applyOptions();
}

/** Elo cap in 1320–3190, or null for full strength. */
export function setEloCap(elo) {
  eloCap = elo == null ? null : clamp(elo, 1320, 3190);
  applyOptions();
}

/** Fixed search depth, or null to search by time. */
export function setDepth(n) {
  depth = n == null ? null : clamp(n, 1, 30);
}

/** Think time per move in milliseconds. */
export function setMoveTime(ms) {
  moveTime = clamp(ms, 100, 60000);
}

/**
 * Best move and evaluation for a FEN. The score is from White's perspective:
 * { type: 'cp' | 'mate', value }. Returns null if the search was cancelled by stop().
 * opts: { depth?, movetime? } override the configured limits for this call.
 */
export function analyse(fen, opts = {}) {
  const gen = generation;
  const job = chain.then(() => (gen === generation ? runSearch(fen, opts) : null));
  chain = job.catch(() => null);
  return job;
}

/** Cancels the running search and drops queued ones. */
export function stop() {
  generation++;
  if (search) send('stop');
}
