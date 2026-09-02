// ============================================================
// useStorageJanitor — runs the TTL cleanup on mount + every 24h.
// ============================================================
import { useInterval } from '@/hooks/useInterval';
import { runJanitor } from '@/storage/janitor';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Mount this once near the root of the app. Safe to mount multiple
 * times — each instance will run an independent cleanup, but idb's
 * transactions are cheap enough that this is fine in practice.
 */
export function useStorageJanitor() {
  useInterval(() => {
    runJanitor().catch((err) => {
      // Janitor failures should never crash the app — log and move on.
      console.warn('[janitor] cleanup failed', err);
    });
  }, ONE_DAY_MS);
}