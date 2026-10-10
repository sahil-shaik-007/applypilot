#!/usr/bin/env node
/*
 * ApplyPilot release helper. Used locally and by .github/workflows/{windows,release}.yml.
 *
 *   node scripts/release.js prepare 1.2.1 [--dry-run]   bump version, check CHANGELOG, commit + tag v1.2.1
 *   node scripts/release.js build [--appx] [--appx-only] [--prepackaged]
 *                                                     run electron-builder (never publishes); env-driven
 *                                                     signing and Store identity, see below
 *   node scripts/release.js check                     verify release/: installer, .blockmap, latest.yml
 *                                                     (version + sha512), app-update.yml in win-unpacked
 *   node scripts/release.js winget [version] [--out dir]
 *                                                     render store/winget/templates for the built installer
 *   node scripts/release.js notes [version]           print the CHANGELOG section for a version
 *   node scripts/release.js appx-assets [--src png]   render Store tiles into build/appx/ from the logo
 *
 * Environment read by `build` (all optional; empty values are ignored):
 *   CSC_LINK, CSC_KEY_PASSWORD                 .pfx code-signing certificate (electron-builder reads them)
 *   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET,
 *   AZURE_SIGN_ENDPOINT, AZURE_SIGN_ACCOUNT, AZURE_SIGN_PROFILE, AZURE_SIGN_PUBLISHER
 *                                              Azure Artifact Signing (formerly Trusted Signing)
 *   APPX_IDENTITY_NAME, APPX_PUBLISHER, APPX_PUBLISHER_DISPLAY_NAME
 *                                              Microsoft Store identity from Partner Center; overrides
 *                                              the TODO placeholders in package.json build.appx
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const RELEASE = path.join(ROOT, 'release');
const WINGET_TEMPLATES = path.join(ROOT, 'store', 'winget', 'templates');

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const positional = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1] === '--out'));
const env = (k) => (process.env[k] || '').trim();

const readPkg = () => JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
const die = (msg) => { console.error(`release: ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`  ok  ${msg}`);
const sha = (algo, file, enc) => crypto.createHash(algo).update(fs.readFileSync(file)).digest(enc);
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function changelogSection(version) {
  const text = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^## \\[?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`).test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}

// ---------------------------------------------------------------- prepare
function prepare() {
  const version = (positional[0] || '').replace(/^v/, '');
  if (!SEMVER.test(version)) die('usage: release.js prepare <x.y.z> [--dry-run]');
  const dry = flag('--dry-run');
  const dirty = git('status', '--porcelain', '--untracked-files=no');
  if (dirty && !dry) die('working tree has uncommitted changes; commit or stash them first');
  if (git('tag', '--list', `v${version}`)) die(`tag v${version} already exists`);
  if (!changelogSection(version)) die(`CHANGELOG.md has no "## [${version}]" section; write the release notes first`);

  const raw = fs.readFileSync(PKG_PATH, 'utf8');
  const current = readPkg().version;
  const bumped = raw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`); // first match = top-level version
  const lockPath = path.join(ROOT, 'package-lock.json');
  console.log(`version ${current} -> ${version}${dry ? ' (dry run, nothing written)' : ''}`);
  if (dry) return;
  fs.writeFileSync(PKG_PATH, bumped);
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    lock.version = version;
    if (lock.packages && lock.packages['']) lock.packages[''].version = version;
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  }
  git('add', 'package.json', 'package-lock.json');
  git('commit', '-m', `release: v${version}`);
  git('tag', '-a', `v${version}`, '-m', `ApplyPilot ${version}`);
  console.log(`\nCommitted and tagged v${version}. Push to start the release pipeline:\n  git push origin HEAD --follow-tags`);
}

// ---------------------------------------------------------------- build
async function build() {
  const { build: ebBuild, Platform, Arch } = require('electron-builder');
  const targets = flag('--appx-only') ? ['appx'] : flag('--appx') ? ['nsis', 'appx'] : ['nsis'];
  const config = {};

  const appx = {};
  if (env('APPX_IDENTITY_NAME')) appx.identityName = env('APPX_IDENTITY_NAME');
  if (env('APPX_PUBLISHER')) appx.publisher = env('APPX_PUBLISHER');
  if (env('APPX_PUBLISHER_DISPLAY_NAME')) appx.publisherDisplayName = env('APPX_PUBLISHER_DISPLAY_NAME');
  if (Object.keys(appx).length) config.appx = appx;
  if (targets.includes('appx') && !appx.identityName && /TODO/.test(readPkg().build.appx.identityName)) {
    console.warn('release: build.appx still has TODO placeholders. Fine for a test build; the Store will reject it.');
  }

  const azure = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_SIGN_ENDPOINT', 'AZURE_SIGN_ACCOUNT', 'AZURE_SIGN_PROFILE', 'AZURE_SIGN_PUBLISHER'];
  if (azure.every(env)) {
    config.win = {
      azureSignOptions: {
        publisherName: env('AZURE_SIGN_PUBLISHER'),
        endpoint: env('AZURE_SIGN_ENDPOINT'),
        codeSigningAccountName: env('AZURE_SIGN_ACCOUNT'),
        certificateProfileName: env('AZURE_SIGN_PROFILE'),
      },
    };
    console.log('release: signing with Azure Artifact Signing');
  } else if (env('CSC_LINK')) {
    console.log('release: signing with the CSC_LINK certificate');
  } else {
    for (const k of ['CSC_LINK', 'CSC_KEY_PASSWORD']) delete process.env[k]; // empty strings confuse electron-builder
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
    console.log('release: no signing credentials, building UNSIGNED (SmartScreen will warn users)');
  }

  const files = [];
  const run = async (t, prepackaged) => files.push(...(await ebBuild({
    targets: Platform.WINDOWS.createTarget(t, Arch.x64),
    config,
    publish: 'never', // uploads happen in .github/workflows/release.yml, never from a laptop by accident
    ...(prepackaged ? { prepackaged } : {}),
  })));

  if (targets.includes('nsis')) await run(['nsis'], flag('--prepackaged') ? path.join(RELEASE, 'win-unpacked') : null);
  if (targets.includes('appx')) {
    // The Store package must never self-update (Store policy 10.2.5): repackage a copy of the app
    // WITHOUT resources/app-update.yml, so electron-updater has no feed and its check is a no-op.
    const unpacked = path.join(RELEASE, 'win-unpacked');
    if (!fs.existsSync(path.join(unpacked, 'ApplyPilot.exe'))) await run(['dir'], null);
    const storeDir = path.join(RELEASE, 'win-unpacked-store');
    fs.rmSync(storeDir, { recursive: true, force: true });
    fs.cpSync(unpacked, storeDir, { recursive: true });
    fs.rmSync(path.join(storeDir, 'resources', 'app-update.yml'), { force: true });
    await run(['appx'], storeDir);
  }
  console.log('\nbuilt:\n' + files.map((f) => '  ' + path.relative(ROOT, f)).join('\n'));
}

// ---------------------------------------------------------------- check
function parseLatestYml(text) {
  const out = { files: [] };
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    let m;
    if ((m = line.match(/^\s*-\s*url:\s*(.+)$/))) { cur = { url: m[1].trim() }; out.files.push(cur); }
    else if (cur && (m = line.match(/^\s+(sha512|size):\s*(.+)$/))) cur[m[1]] = m[2].trim();
    else if ((m = line.match(/^(\w+):\s*(.*)$/))) { cur = null; out[m[1]] = m[2].trim().replace(/^'|'$/g, ''); }
  }
  return out;
}

function check() {
  const pkg = readPkg();
  const v = pkg.version;
  const exe = path.join(RELEASE, `ApplyPilot-Setup-${v}.exe`);
  const problems = [];
  const need = (cond, msg) => (cond ? ok(msg) : problems.push(msg));
  console.log(`checking release/ for ${v}`);

  need(fs.existsSync(exe), `installer ${path.basename(exe)}`);
  need(fs.existsSync(exe + '.blockmap'), 'installer .blockmap (differential updates)');
  const latestPath = path.join(RELEASE, 'latest.yml');
  if (fs.existsSync(latestPath) && fs.existsSync(exe)) {
    const latest = parseLatestYml(fs.readFileSync(latestPath, 'utf8'));
    need(latest.version === v, `latest.yml version ${latest.version}`);
    const entry = latest.files.find((f) => f.url === path.basename(exe));
    need(!!entry, 'latest.yml lists the installer');
    if (entry) {
      need(entry.sha512 === sha('sha512', exe, 'base64'), 'latest.yml sha512 matches the installer');
      need(Number(entry.size) === fs.statSync(exe).size, 'latest.yml size matches the installer');
    }
  } else {
    problems.push('latest.yml missing (is build.publish configured?)');
  }

  const upd = path.join(RELEASE, 'win-unpacked', 'resources', 'app-update.yml');
  if (fs.existsSync(upd)) {
    const text = fs.readFileSync(upd, 'utf8');
    const pub = (pkg.build.publish || [])[0] || {};
    need(/provider:\s*github/.test(text), 'app-update.yml provider github');
    need(new RegExp(`owner:\\s*${pub.owner}`).test(text), `app-update.yml owner ${pub.owner}`);
    need(new RegExp(`repo:\\s*${pub.repo}`).test(text), `app-update.yml repo ${pub.repo}`);
    need(/updaterCacheDirName:/.test(text), 'app-update.yml updaterCacheDirName');
  } else {
    problems.push('release/win-unpacked/resources/app-update.yml missing');
  }

  for (const f of fs.readdirSync(RELEASE).filter((n) => /\.(appx|msix)$/i.test(n))) ok(`store package ${f} (${(fs.statSync(path.join(RELEASE, f)).size / 1048576).toFixed(1)} MB)`);
  if (problems.length) die('FAILED:\n' + problems.map((p) => '  - ' + p).join('\n'));
  console.log('release artifacts look good');
}

// ---------------------------------------------------------------- winget
function winget() {
  const pkg = readPkg();
  const version = (positional[0] || pkg.version).replace(/^v/, '');
  const exe = path.join(RELEASE, `ApplyPilot-Setup-${version}.exe`);
  if (!fs.existsSync(exe)) die(`${path.relative(ROOT, exe)} not found; build it (npm run dist) or download it from the release`);
  const pub = (pkg.build.publish || [])[0] || { owner: 'sahil-shaik-007', repo: 'applypilot-releases' };
  const vars = {
    VERSION: version,
    INSTALLER_URL: `https://github.com/${pub.owner}/${pub.repo}/releases/download/v${version}/ApplyPilot-Setup-${version}.exe`,
    INSTALLER_SHA256: sha('sha256', exe, 'hex').toUpperCase(),
    RELEASE_DATE: new Date().toISOString().slice(0, 10),
    RELEASE_NOTES_URL: `https://github.com/${pub.owner}/${pub.repo}/releases/tag/v${version}`,
  };
  const outDir = path.resolve(ROOT, opt('--out') || path.join('release', 'winget', version));
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of fs.readdirSync(WINGET_TEMPLATES).filter((n) => n.endsWith('.yaml'))) {
    const text = fs.readFileSync(path.join(WINGET_TEMPLATES, name), 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => {
      if (!(k in vars)) die(`unknown placeholder ${m} in ${name}`);
      return vars[k];
    });
    fs.writeFileSync(path.join(outDir, name), text);
    ok(path.relative(ROOT, path.join(outDir, name)));
  }
  console.log(`\nValidate and submit (see store/winget/README.md):\n  winget validate --manifest "${outDir}"\n  wingetcreate submit "${outDir}"`);
}

// ---------------------------------------------------------------- appx-assets
// Microsoft Store tile images for build/appx/ (electron-builder copies that folder into the package).
// Rendered with Edge from the 1024 px brand icon; re-run after a logo change.
async function appxAssets() {
  const src = path.resolve(ROOT, opt('--src') || path.join('assets', 'brand', 'png', 'icon-1024.png'));
  if (!fs.existsSync(src)) die(`${src} not found (pass --src <1024px png>)`);
  const outDir = path.join(ROOT, 'build', 'appx');
  fs.mkdirSync(outDir, { recursive: true });
  // [file, width, height, icon size as a fraction of the height]
  const assets = [
    ['StoreLogo.png', 50, 50, 1], ['Square44x44Logo.png', 44, 44, 1], ['SmallTile.png', 71, 71, 0.8],
    ['Square150x150Logo.png', 150, 150, 0.66], ['Wide310x150Logo.png', 310, 150, 0.66], ['LargeTile.png', 310, 310, 0.6],
  ];
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const dataUrl = 'data:image/png;base64,' + fs.readFileSync(src).toString('base64');
    for (const [name, w, h, frac] of assets) {
      const b64 = await page.evaluate(async ({ dataUrl, w, h, frac }) => {
        const img = new Image(); img.src = dataUrl; await img.decode();
        // Downscale in halving steps for a crisp result at small sizes.
        let cur = img; let size = img.width; const target = Math.round(h * frac);
        while (size / 2 >= target) {
          const c = document.createElement('canvas'); c.width = c.height = size / 2;
          const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, size / 2, size / 2);
          cur = c; size /= 2;
        }
        const out = document.createElement('canvas'); out.width = w; out.height = h;
        const ctx = out.getContext('2d'); ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(cur, Math.round((w - target) / 2), Math.round((h - target) / 2), target, target);
        return out.toDataURL('image/png').split(',')[1];
      }, { dataUrl, w, h, frac });
      fs.writeFileSync(path.join(outDir, name), Buffer.from(b64, 'base64'));
      ok(`build/appx/${name} ${w}x${h}`);
    }
  } finally { await browser.close(); }
}

// ---------------------------------------------------------------- notes
function notes() {
  const version = (positional[0] || readPkg().version).replace(/^v/, '');
  const section = changelogSection(version);
  if (!section) die(`no CHANGELOG.md section for ${version}`);
  process.stdout.write(section + '\n');
}

const commands = { prepare, build, check, winget, notes, 'appx-assets': appxAssets };
if (!commands[cmd]) {
  const lines = fs.readFileSync(__filename, 'utf8').split(/\r?\n/);
  console.log(lines.slice(2, lines.indexOf(' */')).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
  process.exit(cmd ? 1 : 0);
}
Promise.resolve(commands[cmd]()).catch((e) => die(e.stack || e.message));
