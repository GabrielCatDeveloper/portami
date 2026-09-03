import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/global.css';
import 'leaflet/dist/leaflet.css';
import App from './App';
import { startMockServer } from '../mocks/browser';
import { startServerHealthOnce } from '@/state/health';
import { getApiBase } from '@/api/client';
import { useTestingStore } from '@/state/testing';
import { initWebMcp, registerAllTools } from '@/webmcp';
import './i18n';

const basename = import.meta.env.BASE_URL;

// MSW is used in three modes:
//  - DEV (always): easy local development without a backend.
//  - PROD when VITE_API_BASE is empty: app falls back to mocks.
//  - PROD when VITE_API_BASE is set but the user has the testing mode
//    enabled in Settings: we force MSW so the app keeps working
//    even when the backend is down or its CORS isn't configured
//    for our origin.
//
// We use BrowserRouter (clean URLs like /portami/settings) instead of
// HashRouter. To make refresh / deep-link work on GitHub Pages, vite is
// configured to copy dist/index.html to dist/404.html in plugins/postbuild.
// GitHub Pages serves 404.html for any unknown path; the SPA then boots
// from it and BrowserRouter reads the actual pathname and routes correctly.
async function bootstrap() {
  const apiBase = getApiBase();
  const testing = useTestingStore.getState();
  // When testing mode is on, MSW always wins — even if a real
  // server is configured — so the app never talks to the network.
  const useMocks = import.meta.env.DEV || !apiBase || testing.enabled;
  if (useMocks) {
    await startMockServer();
  } else {
    // Start polling the real server's /health endpoint.
    startServerHealthOnce(apiBase);
  }

  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <BrowserRouter basename={basename}>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );

  // Register PWA service worker (production only)
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  }

  // Initialise WebMCP (`document.modelContext`) and register every
  // portami tool with it. Best-effort: a failure here never blocks
  // the UI from booting. The polyfill installed by `@mcp-b/global`
  // is what provides the API on browsers without native support.
  const webmcpReady = await initWebMcp();
  if (webmcpReady) {
    try {
      await registerAllTools();
    } catch (err) {
      console.warn('[WebMCP] tool registration failed:', err);
    }
  }
}

void bootstrap();