import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serviceWorker } from './scripts/sw-plugin.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// @capacitor/background-runner loads `public/<src>` ("runners/background.js", capacitor.config.json) from the
// native bundle, so the runner must sit in dist/ before `npx cap sync`. Vite empties dist on every build.
const backgroundRunner = () => ({
  name: 'applypilot-background-runner',
  apply: 'build',
  closeBundle() {
    const out = path.resolve(here, 'dist/runners');
    fs.mkdirSync(out, { recursive: true });
    fs.copyFileSync(path.resolve(here, 'runners/background.js'), path.join(out, 'background.js'));
  },
});

const API_TARGET = process.env.AP_API_TARGET || 'http://localhost:8787';

export default defineConfig(async () => {
  const plugins = [react(), serviceWorker(), backgroundRunner()];
  return {
    plugins,
    base: '/',
    resolve: {
      alias: {
        '@shared': path.resolve(here, '../shared'),
        '@schema': path.resolve(here, '../../electron/data/profile-schema.json'),
      },
    },
    server: {
      port: 5174,
      strictPort: true,
      fs: { allow: [here, path.resolve(here, '../shared'), path.resolve(here, '../../electron/data')] },
      proxy: { '/api': { target: API_TARGET, changeOrigin: false, secure: false } },
    },
    preview: { port: 5174, proxy: { '/api': { target: API_TARGET, changeOrigin: false } } },
    build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2500, sourcemap: false, target: 'es2022' },
    worker: { format: 'es' },
  };
});
