import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles.css';
import { TmaScope } from './tma/Scope.tsx';
import { App } from './app.jsx';
import { connect } from './store.js';

createRoot(document.getElementById('app')).render(
  <TmaScope skin="apple" scheme="dark" className="swrm">
    <App />
    <div data-tma-modal />
  </TmaScope>,
);
connect();

// It is an app, not a web page: no browser right-click menu (Back / Forward / Reload) and no page zoom.
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '0'].includes(e.key)) e.preventDefault(); });
