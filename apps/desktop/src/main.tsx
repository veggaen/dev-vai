import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles/index.css';
import './styles/reasoning-story.css';
import { initOdysseusThemeFromStorage } from './lib/odysseus-theme.js';

initOdysseusThemeFromStorage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
