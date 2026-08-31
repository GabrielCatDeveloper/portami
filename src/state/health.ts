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
  return useSyncExternalStore(
    (cb) => subscribeHealth(cb),
    () => getHealthSnapshot(),
    () => getHealthSnapshot(),
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