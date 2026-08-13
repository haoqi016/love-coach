import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'lxgw-wenkai-webfont/lxgwwenkai-regular.css';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing application root');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}
