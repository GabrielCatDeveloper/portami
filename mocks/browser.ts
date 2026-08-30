import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export async function startMockServer() {
  const worker = setupWorker(...handlers);
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: '/mockServiceWorker.js' },
    quiet: true,
  });
}