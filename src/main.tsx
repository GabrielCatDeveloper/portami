import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/global.css';
import 'leaflet/dist/leaflet.css';
import App from './App';
import { startMockServer } from '../mocks/browser';
import './i18n';

async function bootstrap() {
  if (import.meta.env.DEV) {
    await startMockServer();
  }

  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );

  // Register PWA service worker (production only)
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  }
}

void bootstrap();