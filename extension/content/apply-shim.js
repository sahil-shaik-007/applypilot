// Injected into the job tab right before content/apply-engine.js. It gives the engine the same `window.mobileApp`
// bridge the phone app has, but backed by the extension. It lives in the extension's isolated world, so scripts of the
// job page can neither see nor call it; only the extension's service worker receives what it posts.
/* global chrome */
(function () {
  if (window.mobileApp) return;
  const send = (m) => { try { chrome.runtime.sendMessage(m, () => void chrome.runtime.lastError); } catch { /* extension reloaded */ } };
  Object.defineProperty(window, 'mobileApp', {
    configurable: true,
    value: Object.freeze({
      postMessage: (m) => send({ apEngine: 1, msg: m && m.detail }),
      close: () => send({ apEngine: 1, close: 1 }),
    }),
  });
})();
