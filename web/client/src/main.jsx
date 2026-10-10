import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inconsolata/400.css';
import '@fontsource/inconsolata/500.css';
import '@fontsource/inconsolata/600.css';
import '@fontsource/inconsolata/700.css';
import '@fontsource/geist-pixel/400.css';
import './styles.css';
import App from './App.jsx';
import { registerServiceWorker } from './lib/pwa.js';
// [mobile-native] loads the API base URL + keystore token before the first request (no-op on the web)
import { isNative, initNative } from './native/index.js';
// [/mobile-native]

if (!isNative) registerServiceWorker(); // [mobile-native] the apps ship their assets; no service worker there
initNative().catch(() => {}).finally(() => {
  createRoot(document.getElementById('root')).render(<App />);
});
