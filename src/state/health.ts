// React hook + provider for the server health store.
// Anywhere in the tree: const { status } = useServerHealth()

import { useSyncExternalStore } from 'react';
import {
  getHealthSnapshot,
  startHealthPolling,
  stopHealthPolling,
  subscribeHealth,
  type HealthSnapshot,
} from '@/api/health';

export function useServerHealth(): HealthSnapshot {
  // CRITICAL: pass `subscribeHealth` and `getHealthSnapshot` directly
  // (module-level references). Wrapping them in arrow functions
  // creates a fresh function on every render, which makes React's
  // internal useEffect re-subscribe on every render — and since
  // subscribeHealth immediately calls back with `snapshot()`, that
  // schedules another render, producing an infinite loop
  // ("Maximum update depth exceeded" / React error #185).
  return useSyncExternalStore(
    subscribeHealth,
    getHealthSnapshot,
    getHealthSnapshot,
  );
}

let started = false;
export function startServerHealthOnce(baseUrl: string): void {
  if (started) return;
  started = true;
  startHealthPolling(baseUrl);
}

export function stopServerHealth(): void {
  stopHealthPolling();
  started = false;
}