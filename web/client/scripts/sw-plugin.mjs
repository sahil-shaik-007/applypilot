// Emits dist/sw.js at build time. The service worker caches ONLY the static app shell
// (index.html, hashed /assets/*, manifest and icons). It never touches /api or any other origin,
// so no user data or API response ever lands in the Cache Storage.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function serviceWorker() {
  return {
    name: 'applypilot-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => f !== 'sw.js');
      const entry = Object.values(bundle).filter((c) => c.type === 'chunk' && c.isEntry).flatMap((c) => [c.fileName, ...(c.viteMetadata?.importedCss || [])]);
      const shell = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', ...entry.map((f) => `/${f}`)];
      const version = crypto.createHash('sha256').update(files.sort().join('|')).digest('hex').slice(0, 12);
      const src = fs.readFileSync(path.join(here, 'sw.template.js'), 'utf8')
        .replace('__VERSION__', version)
        .replace('__SHELL__', JSON.stringify([...new Set(shell)]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}
