import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { initTheme } from './lib/theme';
import { mayReloadForNewBuild } from './lib/stale-build';
import './index.css';

initTheme();

// Vite reports a lazily loaded chunk it could not fetch here: after a deploy,
// the page is asking for files the new build no longer serves.
window.addEventListener('vite:preloadError', () => {
  if (mayReloadForNewBuild()) window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
