// Single responsibility: boot the app. Creates the modules, wires them together and gates play on the engine loading.
import { createBoard } from './board.js';
import { createPanels } from './ui-panels.js';
import { createGame } from './game.js';
import { createEvalBar } from './eval-bar.js';
import * as engine from './engine.js';
import { getSettings, subscribe, renderSettings } from './settings.js';

const $ = (selector) => document.querySelector(selector);

function applyEngineSettings(s) {
  engine.setSkillLevel(s.skill);
  engine.setEloCap(s.eloCap);
  engine.setDepth(s.depth);
  engine.setMoveTime(s.moveTimeMs);
}

async function boot() {
  let game = null;
  const evalBar = createEvalBar($('#eval-bar'));

  const board = createBoard($('#board'), {
    onMove: (from, to, promotion) => game.playerMove(from, to, promotion),
    targetsFor: (sq) => game.targetsFor(sq),
  });

  const panels = createPanels({
    controls: $('#controls'),
    newGame: $('#new-game'),
    moves: $('#moves'),
    clocks: $('#clocks'),
    gameOver: $('#game-over'),
    toast: $('#toast'),
  }, {
    onUndo: () => game.undo(),
    onRedo: () => game.redo(),
    onHint: () => game.hint(),
    onFlip: () => board.flip(),
    onDraw: () => game.offerDraw(),
    onResign: () => { if (confirm('Resign this game?')) game.resign(); },
    onCopyPgn: () => game.copyPgn(),
    onLoadFen: (fen) => game.loadFen(fen),
    onNewGame: (opts) => game.newGame(opts),
    onGoTo: (ply) => game.goTo(ply),
    onStep: (delta) => game.stepBy(delta),
  });

  game = createGame({ board, panels, evalBar, getSettings });

  renderSettings($('#settings'));
  applyEngineSettings(getSettings());
  evalBar.setVisible(getSettings().evalBar);
  subscribe((s) => {
    applyEngineSettings(s);
    evalBar.setVisible(s.evalBar);
    game.repaint();
  });

  const status = $('#engine-status');
  try {
    status.textContent = 'Loading Stockfish…';
    await engine.init(); // resolves after uciok and readyok
    status.textContent = 'Stockfish ready';
    $('#loading').classList.add('hidden');
    game.start();
  } catch (err) {
    status.textContent = 'Engine unavailable';
    $('#loading p').textContent =
      `Could not start Stockfish (${err.message}). Check the vendor/stockfish files in the setup steps.`;
  }
}

boot();