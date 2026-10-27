// Single responsibility: copy the static web app into dist/, the folder Tauri embeds. Keeps src-tauri/ and node_modules/ out of the bundle.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const entry of ['index.html', 'styles.css', 'NOTICE.md', 'js', 'vendor']) {
  cpSync(join(root, entry), join(dist, entry), { recursive: true });
}
console.log('Copied web app to dist/');
