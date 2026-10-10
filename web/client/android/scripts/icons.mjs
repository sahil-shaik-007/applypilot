// Regenerates the Android launcher icons (legacy + round + adaptive) and splash screens
// from the single source logo build/icon.png, on the ApplyPilot #0a0a0a background.
//
//   cd web/client && npm run icons:android        (or: node android/scripts/icons.mjs)
//
// Uses @capacitor/assets "easy mode" (logo.png + background colours). Re-run whenever
// build/icon.png changes; outputs go to android/app/src/main/res (mipmap-*, drawable-*).
// Optional: ICON_SRC=path/to/logo.png to use a different (ideally >= 1024 px) source.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, '../..');                    // web/client
const src = path.resolve(process.env.ICON_SRC || path.join(clientDir, '../../build/icon.png'));
const stageRel = 'android/.icon-src';                               // gitignored
const stage = path.join(clientDir, stageRel);
const BG = process.env.ICON_BG || '#0a0a0a';

if (!fs.existsSync(src)) { console.error(`[icons:android] source not found: ${src}`); process.exit(1); }
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.copyFileSync(src, path.join(stage, 'logo.png'));
fs.copyFileSync(src, path.join(stage, 'logo-dark.png'));

const bin = path.join(clientDir, 'node_modules', '.bin', process.platform === 'win32' ? 'capacitor-assets.cmd' : 'capacitor-assets');
const args = ['generate', '--android', '--assetPath', stageRel,
  '--iconBackgroundColor', BG, '--iconBackgroundColorDark', BG,
  '--splashBackgroundColor', BG, '--splashBackgroundColorDark', BG,
  '--logoSplashScale', process.env.SPLASH_SCALE || '0.3'];
console.log(`[icons:android] ${path.relative(clientDir, src)} -> android/app/src/main/res (bg ${BG})`);
const r = spawnSync(bin, args, { cwd: clientDir, stdio: 'inherit', shell: process.platform === 'win32' });
fs.rmSync(stage, { recursive: true, force: true });
if (r.status !== 0) { console.error('[icons:android] capacitor-assets failed'); process.exit(r.status || 1); }

// The adaptive icon background must stay the brand colour even if capacitor-assets changes defaults.
const bgXml = path.join(clientDir, 'android/app/src/main/res/values/ic_launcher_background.xml');
fs.writeFileSync(bgXml, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);
console.log('[icons:android] done');
