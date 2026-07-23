import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { DictationBubble } from './components/chat/DictationBubble.js';
import { PopoutHost } from './components/shell/PopoutHost.js';
import { getPopoutPanelFromUrl } from './stores/popoutStore.js';
import './styles/index.css';
import './styles/reasoning-story.css';
import './styles/layout-modes.css';
import './styles/adaptive.css';
import './styles/dictation-bubble.css';
import { initOdysseusThemeFromStorage } from './lib/odysseus-theme.js';

initOdysseusThemeFromStorage();

// The standalone dictation bubble runs the same bundle in its own tiny window
// (see Rust `ensure_dictation_bubble`) — route on the window's query string.
const windowParams = new URLSearchParams(window.location.search);
const isBubbleWindow = windowParams.get('view') === 'dictation-bubble';
if (isBubbleWindow) {
  document.documentElement.dataset.view = 'dictation-bubble';
  document.body.dataset.view = 'dictation-bubble';
  if (import.meta.env.DEV && windowParams.has('preview')) {
    document.documentElement.dataset.preview = 'true';
  }
}

// Popout panels ("Lego UI") run the same bundle in their own window too —
// ?popout=chat|app|console renders that single panel full-window.
const popoutPanel = getPopoutPanelFromUrl();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isBubbleWindow ? <DictationBubble /> : popoutPanel ? <PopoutHost panel={popoutPanel} /> : <App />}
  </StrictMode>,
);
