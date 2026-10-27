// Single responsibility: user settings (engine strength, think time, theme, pieces, sound, eval bar), persisted to localStorage.
const STORAGE_KEY = 'exy-chess.settings';
const THEMES = ['classic', 'green', 'blue'];
const PIECE_SETS = ['unicode', 'alpha'];

export const DEFAULTS = {
  skill: 20,
  eloCap: null,
  moveTimeMs: 1000,
  depth: null,
  theme: 'classic',
  pieceSet: 'unicode',
  sound: true,
  evalBar: true,
};

const listeners = new Set();

function clampInt(v, lo, hi, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
}

function sanitize(raw) {
  return {
    skill: clampInt(raw.skill, 0, 20, DEFAULTS.skill),
    eloCap: raw.eloCap == null ? null : clampInt(raw.eloCap, 1320, 3190, null),
    moveTimeMs: clampInt(raw.moveTimeMs, 100, 10000, DEFAULTS.moveTimeMs),
    depth: raw.depth == null ? null : clampInt(raw.depth, 1, 30, null),
    theme: THEMES.includes(raw.theme) ? raw.theme : DEFAULTS.theme,
    pieceSet: PIECE_SETS.includes(raw.pieceSet) ? raw.pieceSet : DEFAULTS.pieceSet,
    sound: typeof raw.sound === 'boolean' ? raw.sound : DEFAULTS.sound,
    evalBar: typeof raw.evalBar === 'boolean' ? raw.evalBar : DEFAULTS.evalBar,
  };
}

function load() {
  try {
    return sanitize({ ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') });
  } catch {
    return sanitize(DEFAULTS);
  }
}

let current = load();

const FIELDS = [
  { key: 'skill', label: 'Strength (skill 0–20)', type: 'range', min: 0, max: 20 },
  {
    key: 'eloCap', label: 'Elo cap', type: 'select',
    options: [['', 'Off (full strength)'], ['1350', '1350'], ['1500', '1500'], ['1800', '1800'], ['2200', '2200'], ['2600', '2600']],
  },
  {
    key: 'moveTimeMs', label: 'Think time', type: 'select',
    options: [[300, '0.3 s'], [1000, '1 s'], [2000, '2 s'], [3000, '3 s'], [5000, '5 s']],
  },
  {
    key: 'depth', label: 'Depth limit (overrides think time)', type: 'select',
    options: [['', 'Off'], ['4', '4'], ['8', '8'], ['12', '12'], ['16', '16']],
  },
  { key: 'theme', label: 'Board theme', type: 'select', options: THEMES.map((t) => [t, t]) },
  { key: 'pieceSet', label: 'Pieces', type: 'select', options: [['unicode', 'Unicode glyphs'], ['alpha', 'SVG discs']] },
  { key: 'sound', label: 'Move sounds', type: 'checkbox' },
  { key: 'evalBar', label: 'Evaluation bar', type: 'checkbox' },
];

function fieldMarkup(f, s) {
  const v = s[f.key];
  if (f.type === 'checkbox') {
    return `<label class="check"><input type="checkbox" name="${f.key}"${v ? ' checked' : ''}> ${f.label}</label>`;
  }
  if (f.type === 'range') {
    return `<label>${f.label} <output>${v}</output>` +
      `<input type="range" name="${f.key}" min="${f.min}" max="${f.max}" value="${v}"></label>`;
  }
  const options = f.options
    .map(([val, text]) => `<option value="${val}"${String(v ?? '') === String(val) ? ' selected' : ''}>${text}</option>`)
    .join('');
  return `<label>${f.label}<select name="${f.key}">${options}</select></label>`;
}

function readField(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.name === 'eloCap' || el.name === 'depth') return el.value === '' ? null : Number(el.value);
  if (el.name === 'skill' || el.name === 'moveTimeMs') return Number(el.value);
  return el.value;
}

export function getSettings() {
  return current;
}

export function updateSettings(patch) {
  current = sanitize({ ...current, ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: settings still apply for this session */
  }
  listeners.forEach((fn) => fn(current));
  return current;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Builds the settings form inside container and keeps it in sync with updateSettings. */
export function renderSettings(container) {
  container.innerHTML = `<h2>Settings</h2><form class="settings">${FIELDS.map((f) => fieldMarkup(f, current)).join('')}</form>`;
  const form = container.querySelector('form');
  form.addEventListener('input', (e) => {
    if (e.target.type === 'range') e.target.closest('label').querySelector('output').textContent = e.target.value;
  });
  form.addEventListener('change', (e) => {
    updateSettings({ [e.target.name]: readField(e.target) });
  });
}