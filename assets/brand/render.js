// Renders an HTML/SVG file to PNG with the installed Edge (used for brand assets).
//   node assets/brand/render.js <in.html|in.svg> <out.png> [width] [height] [scale]
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

(async () => {
  const [, , input, out, w = '1200', h = '520', scale = '1'] = process.argv;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +scale });
  await page.goto(pathToFileURL(path.resolve(input)).href);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out, omitBackground: true });
  await browser.close();
})();
