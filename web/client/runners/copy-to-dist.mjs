// Copies the background runner into the built web assets. @capacitor/background-runner loads
// `public/<src>` from the native bundle (capacitor.config.json: "src": "runners/background.js"),
// i.e. dist/runners/background.js after `npx cap sync`. Run after `vite build`:
//   node runners/copy-to-dist.mjs        (from web/client)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../dist');
if (!fs.existsSync(dist)) { console.error('web/client/dist not found: run `vite build` first'); process.exit(1); }
fs.mkdirSync(path.join(dist, 'runners'), { recursive: true });
fs.copyFileSync(path.join(here, 'background.js'), path.join(dist, 'runners', 'background.js'));
console.log('copied runners/background.js -> dist/runners/background.js');
