#!/usr/bin/env node
// Regenerates the iOS app icon and launch (splash) images with @capacitor/assets.
//
//   cd web/client && npm run icons:ios        (or: node ios/scripts/icons.mjs)
//
// Sources (first one found wins), so re-running after a logo change is all that is needed:
//   1. assets/brand/png/background-1024.png + foreground-1024.png  (brand kit; full-bleed, opaque)
//   2. assets/brand/png/icon-1024.png                              (flattened on #0a0a0a)
//   3. build/icon.png                                               (legacy desktop icon)
// Launch image: assets/brand/png/mark-512.png (or the icon) centred on #0a0a0a.
//
// iOS rules this script enforces: the 1024x1024 App Store icon must be square, opaque (no alpha)
// and un-rounded — iOS applies the corner mask itself.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const client = path.resolve(here, '..', '..');            // web/client
const root = path.resolve(client, '..', '..');            // repo root
const require = createRequire(path.join(client, 'package.json'));
const sharp = require('sharp');                            // ships with @capacitor/assets

const BG = '#0a0a0a';
const brand = (f) => path.join(root, 'assets', 'brand', 'png', f);
const exists = (p) => fs.existsSync(p);

const STAGE_REL = path.join('ios', '.assets-src');        // capacitor-assets joins this with web/client
const stage = path.join(client, STAGE_REL);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// ---- App icon (1024, opaque, full bleed) -------------------------------------------------
let iconSrc;
if (exists(brand('background-1024.png')) && exists(brand('foreground-1024.png'))) {
  // The adaptive foreground keeps the mark inside Android's 66% safe zone; iOS icons fill more
  // of the tile, so the mark is enlarged ~1.7x around the centre.
  const scale = 1.7;
  const size = Math.round(1024 * scale);
  const off = Math.round((size - 1024) / 2);
  const fg = await sharp(brand('foreground-1024.png')).resize(size, size)
    .extract({ left: off, top: off, width: 1024, height: 1024 }).png().toBuffer();
  await sharp(brand('background-1024.png')).resize(1024, 1024)
    .composite([{ input: fg }]).flatten({ background: BG }).removeAlpha()
    .png().toFile(path.join(stage, 'icon-only.png'));
  iconSrc = 'assets/brand (background + foreground)';
} else {
  const src = exists(brand('icon-1024.png')) ? brand('icon-1024.png') : path.join(root, 'build', 'icon.png');
  await sharp(src).resize(1024, 1024).flatten({ background: BG }).removeAlpha()
    .png().toFile(path.join(stage, 'icon-only.png'));
  iconSrc = path.relative(root, src);
}

// ---- Launch image (2732x2732, mark centred on the dark background) -----------------------
const markSrc = exists(brand('mark-512.png')) ? brand('mark-512.png') : path.join(stage, 'icon-only.png');
const mark = await sharp(markSrc).resize(560, 560, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
for (const name of ['splash.png', 'splash-dark.png']) {
  await sharp({ create: { width: 2732, height: 2732, channels: 3, background: BG } })
    .composite([{ input: mark, gravity: 'center' }]).png().toFile(path.join(stage, name));
}

// ---- Hand off to @capacitor/assets ---------------------------------------------------------
const bin = path.join(client, 'node_modules', '@capacitor', 'assets', 'bin', 'capacitor-assets');
const r = spawnSync(process.execPath, [bin, 'generate', '--ios', '--assetPath', STAGE_REL,
  '--iconBackgroundColor', BG, '--iconBackgroundColorDark', BG,
  '--splashBackgroundColor', BG, '--splashBackgroundColorDark', BG], { cwd: client, stdio: 'inherit' });
fs.rmSync(stage, { recursive: true, force: true });
if (r.status !== 0) process.exit(r.status ?? 1);

// Drop images no longer referenced by the catalogs (e.g. the template's splash-2732x2732*.png),
// so stale artwork never ships. The icon set stays "Single Size" (one 1024 image, Xcode 14+).
for (const set of ['AppIcon.appiconset', 'Splash.imageset']) {
  const dir = path.join(client, 'ios', 'App', 'App', 'Assets.xcassets', set);
  const contents = JSON.parse(fs.readFileSync(path.join(dir, 'Contents.json'), 'utf8'));
  const keep = new Set(contents.images.map((i) => i.filename).filter(Boolean));
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.png') && !keep.has(f)) fs.rmSync(path.join(dir, f));
}
console.log(`iOS icons generated from ${iconSrc}; launch image uses ${path.relative(root, markSrc)} on ${BG}.`);
