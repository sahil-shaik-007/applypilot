// Cross-platform dev runner (no extra dependencies).
//   node server/scripts/dev.js                → API server (watch mode, dev login on) + Vite client
//   node server/scripts/dev.js --server-only  → API server only
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const serverOnly = process.argv.includes('--server-only');
const env = { ...process.env, AP_DEV_LOGIN: process.env.AP_DEV_LOGIN ?? '1' };
if (env.NODE_ENV === 'production') {
  console.error('dev runner refuses to run with NODE_ENV=production');
  process.exit(1);
}

const children = [];
function run(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: webDir, env, stdio: 'inherit', ...opts });
  child.on('exit', (code, sig) => {
    console.log(`[dev] ${name} exited (${sig || code})`);
    for (const c of children) if (c !== child && c.exitCode === null) c.kill();
    process.exitCode = code || 0;
  });
  children.push(child);
}

run('server', process.execPath, ['--env-file-if-exists=.env', '--watch', 'server/index.js']);
if (!serverOnly) {
  // npm is a .cmd shim on Windows, which must be started through a shell.
  run('client', 'npm', ['--prefix', 'client', 'run', 'dev'], { shell: process.platform === 'win32' });
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { for (const c of children) c.kill(); });
