#!/usr/bin/env node
// Builds every raster brand asset from the SVG sources in assets/brand/.
//   node assets/brand/build-icons.js
// Outputs:
//   assets/brand/png/*.png         — icon/mark/foreground/background at all sizes
//   build/icon.png, build/icon.ico  — Windows app, installer, tray (multi-size ICO, hand-rendered sizes)
//   src/assets/mark.svg            — desktop UI mark
//   web/client/public/brand/*      — PWA / mobile UI brand files
//   assets/brand/wordmark.png      — README / store header
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const B = __dirname;
const OUT = path.join(B, 'png');
fs.mkdirSync(OUT, { recursive: true });

async function render(page, svgFile, size, out) {
  const html = `<!doctype html><html><body style="margin:0;background:transparent"><img src="${pathToFileURL(path.join(B, svgFile)).href}" style="width:${size}px;height:${size}px;display:block"></body></html>`;
  const tmp = path.join(require('os').tmpdir(), `ap-render-${process.pid}-${size}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmp, html);
  await page.setViewportSize({ width: size, height: size });
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator('img').evaluate((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; })));
  await page.waitForTimeout(80);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  fs.unlinkSync(tmp);
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 180, 192, 256, 512, 1024];
  for (const s of sizes) await render(page, 'applypilot-icon.svg', s, path.join(OUT, `icon-${s}.png`));
  for (const s of [64, 128, 256, 512]) await render(page, 'applypilot-mark.svg', s, path.join(OUT, `mark-${s}.png`));
  await render(page, 'applypilot-foreground.svg', 1024, path.join(OUT, 'foreground-1024.png'));
  await render(page, 'applypilot-background.svg', 1024, path.join(OUT, 'background-1024.png'));

  // Wordmark (mark + name) with the bundled Inconsolata font.
  const font = pathToFileURL(path.join(ROOT, 'node_modules/@fontsource/inconsolata/files/inconsolata-latin-700-normal.woff2')).href;
  const wm = `<!doctype html><html><head><style>@font-face{font-family:I;src:url(${font})}body{margin:0;background:transparent}
    .w{display:flex;align-items:center;gap:28px;padding:20px 36px 20px 20px;font:700 112px/1 I,monospace;color:#fafafa;letter-spacing:-2px}
    .w span b{color:#8b9cff;font-weight:700}</style></head><body><div class="w" id="w"><img src="${pathToFileURL(path.join(B, 'applypilot-icon.svg')).href}" width="150" height="150"><span>Apply<b>Pilot</b></span></div></body></html>`;
  const tmp = path.join(require('os').tmpdir(), `ap-wordmark-${process.pid}.html`);
  fs.writeFileSync(tmp, wm);
  await page.setViewportSize({ width: 900, height: 200 });
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(800);
  const box = await page.locator('#w').boundingBox();
  await page.screenshot({ path: path.join(B, 'wordmark.png'), omitBackground: true, clip: box });
  // Light-background variant (dark text) for GitHub light theme, documents, stores.
  await page.evaluate(() => { document.querySelector('.w').style.color = '#0a0a0a'; document.querySelector('.w b').style.color = '#4f46e5'; });
  await page.screenshot({ path: path.join(B, 'wordmark-light.png'), omitBackground: true, clip: box });
  fs.unlinkSync(tmp);
  await browser.close();

  // Windows ICO with hand-rendered small sizes (crisp at 16/24/32 px).
  fs.copyFileSync(path.join(OUT, 'icon-512.png'), path.join(ROOT, 'build', 'icon.png'));
  const py = `
from PIL import Image
import os
d = r'${OUT}'
sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
imgs = [Image.open(os.path.join(d, f'icon-{s}.png')).convert('RGBA') for s in sizes]
imgs[-1].save(r'${path.join(ROOT, 'build', 'icon.ico')}', format='ICO', sizes=[(s, s) for s in sizes], append_images=imgs[:-1])
print('ico ok')`;
  execFileSync('python', ['-c', py], { stdio: 'inherit' });

  // UI copies.
  fs.mkdirSync(path.join(ROOT, 'src', 'assets'), { recursive: true });
  fs.copyFileSync(path.join(B, 'applypilot-mark.svg'), path.join(ROOT, 'src', 'assets', 'mark.svg'));
  const pub = path.join(ROOT, 'web', 'client', 'public', 'brand');
  fs.mkdirSync(pub, { recursive: true });
  for (const f of ['applypilot-mark.svg', 'applypilot-icon.svg']) fs.copyFileSync(path.join(B, f), path.join(pub, f));
  console.log('brand assets built');
})();
