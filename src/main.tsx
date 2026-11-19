import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './theme.css';
import { applyTheme, deviceTheme } from './lib/theme';

// The page already carries the saved theme (see index.html); this makes sure of it even if that script could not run.
applyTheme(deviceTheme());

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
