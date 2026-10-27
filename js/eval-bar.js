// Single responsibility: vertical evaluation bar. Draws a White-perspective engine score; it has no engine knowledge.

/** Share of the bar that belongs to White, from 0 to 1. */
export function whiteShare(score) {
  if (score.type === 'mate') return Math.sign(score.value) === 0 ? 0.5 : (score.value > 0 ? 1 : 0);
  return 1 / (1 + 10 ** (-score.value / 400));
}

function formatScore(score) {
  if (score.type === 'mate') return `${score.value < 0 ? '-' : ''}M${Math.abs(score.value)}`;
  const pawns = score.value / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

export function createEvalBar(root) {
  const fill = root.querySelector('.eval-fill');
  const label = root.querySelector('.eval-label');

  function update(score) {
    fill.style.height = `${(whiteShare(score) * 100).toFixed(1)}%`;
    label.textContent = formatScore(score);
  }

  function setVisible(on) {
    root.classList.toggle('hidden', !on);
  }

  return { update, setVisible };
}