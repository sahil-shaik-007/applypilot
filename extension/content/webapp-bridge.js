// ApplyPilot web app <-> extension bridge (docs/WEB-BRIDGE.md). Runs ONLY on the web app's own origin: the localhost
// dev ports in the manifest plus the address the user added in the extension options (registered by background.js).
//
// Page -> here: window.postMessage({ apWeb: 1, dir: 'to-ext', id, type, ... }) on the same window.
// Here -> page: window.postMessage({ apWeb: 1, dir: 'to-page', id, type, ... }).
// Every apply run gets its own long-lived port to the service worker so events stream back while it works.
/* global chrome */
(function () {
  'use strict';
  if (window.__apWebBridge) return; // injected twice (manifest + a tab that was open when the origin was added)
  window.__apWebBridge = 1;

  const ports = new Map(); // application id -> port to the service worker
  const done = new Set(); // ids whose result was delivered
  const tries = new Map(); // id -> reconnect attempts
  const toPage = (m) => { try { window.postMessage({ apWeb: 1, dir: 'to-page', ...m }, location.origin); } catch { /* page gone */ } };
  const okId = (id) => (typeof id === 'string' && id.length > 0 && id.length <= 200) || (typeof id === 'number' && Number.isFinite(id));

  function connect(id, first) {
    let port;
    try { port = chrome.runtime.connect({ name: 'ap-web' }); } catch { return null; } // extension reloaded: nothing to talk to
    ports.set(id, port);
    port.onMessage.addListener((m) => {
      if (!m || typeof m !== 'object' || m.id !== id) return;
      if (m.type === 'event' || m.type === 'ask' || m.type === 'result') toPage(m);
      if (m.type === 'result') { done.add(id); ports.delete(id); try { port.disconnect(); } catch { /* */ } }
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (ports.get(id) !== port) return;
      ports.delete(id);
      // The service worker restarted (or sleeps): reattach so events and the result still reach the page.
      const n = (tries.get(id) || 0) + 1;
      if (done.has(id) || n > 5) return;
      tries.set(id, n);
      setTimeout(() => { if (!done.has(id) && !ports.has(id)) { const p = connect(id); if (p) p.postMessage({ op: 'attach', id, recover: true }); } }, 400 * n);
    });
    return port;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = e.data;
    if (!m || typeof m !== 'object' || m.apWeb !== 1 || m.dir !== 'to-ext' || typeof m.type !== 'string' || !okId(m.id)) return;
    const id = m.id;
    if (m.type === 'ping') {
      try {
        chrome.runtime.sendMessage({ apWeb: 'ping' }, (r) => {
          void chrome.runtime.lastError;
          if (r && r.version) toPage({ id, type: 'pong', version: r.version, engine: r.engine, needsPermission: false });
        });
      } catch { /* extension reloaded */ }
    } else if (m.type === 'apply') {
      if (!m.cfg || typeof m.cfg !== 'object') return;
      done.delete(id); tries.delete(id);
      const port = ports.get(id) || connect(id);
      if (port) port.postMessage({ op: 'apply', id, cfg: m.cfg });
    } else if (m.type === 'answer' || m.type === 'cancel-submit' || m.type === 'cancel') {
      if (done.has(id)) return;
      let port = ports.get(id);
      if (!port) { port = connect(id); if (!port) return; port.postMessage({ op: 'attach', id }); } // after a worker restart
      port.postMessage({ op: m.type, id, qid: m.qid, answer: m.answer });
    }
  });
})();
