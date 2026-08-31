import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './styles/global.css';
import 'leaflet/dist/leaflet.css';
import App from './App';
import { startMockServer } from '../mocks/browser';
import './i18n';

// HashRouter is used instead of BrowserRouter because the app is hosted on
// GitHub Pages, which serves only static files. A path like /portami/settings
// would 404 because there's no settings.html on disk. HashRouter puts routes
// after the `#` (e.g. /portami/#/settings), so the server only ever sees
// `/portami/` and the SPA handles routing entirely client-side. No 404 on
// refresh, no need for a 404.html fallback, and no service-worker routing
// quirks.
async function bootstrap() {
  if (import.meta.env.DEV) {
    await startMockServer();
  }

  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  );

  // Register PWA service worker (production only)
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  }
}

void bootstrap();