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

createRoot(document.getElementById('root')).render(
  <AppProvider>
    <App />
  </AppProvider>,
);
