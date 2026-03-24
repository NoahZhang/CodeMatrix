import { createRoot } from 'react-dom/client';
import './lib/monaco-workers';
import { registerMonacoThemes } from './lib/monaco-theme';
import App from './App';

registerMonacoThemes();

// StrictMode is intentionally omitted — this app relies on imperative side
// effects (PTY sessions, xterm.js DOM, window management) that do not
// tolerate the double-render / double-effect cycle StrictMode imposes in dev.
createRoot(document.getElementById('root')!).render(<App />);
