import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inconsolata/400.css';
import '@fontsource/inconsolata/500.css';
import '@fontsource/inconsolata/600.css';
import '@fontsource/inconsolata/700.css';
import '@fontsource/geist-pixel/400.css';
import './styles.css';
import { AppProvider } from './lib/store';
import App from './App';

// Safety net: if the window is ever taller/wider than the screen's usable area (e.g. after a
// display or scaling change), ask the main process to fit it back above the taskbar.
function checkFit() {
  const tooTall = window.innerHeight > window.screen.availHeight + 2;
  const tooWide = window.innerWidth > window.screen.availWidth + 2;
  if ((tooTall || tooWide) && window.api && window.api.fitWindow) window.api.fitWindow();
}
let fitTimer;
window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(checkFit, 200); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(checkFit, 300); });
setTimeout(checkFit, 1500);

createRoot(document.getElementById('root')).render(
  <AppProvider>
    <App />
  </AppProvider>,
);
