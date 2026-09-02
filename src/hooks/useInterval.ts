// ============================================================
// useInterval — minimal React wrapper around setInterval.
//
// Differences from a plain `setInterval` call inside a `useEffect`:
//   1. Pauses the timer when the page is hidden (document.hidden)
//      so we don't burn the user's battery on background tabs.
//   2. Clears the interval on unmount, and is safe against
//      double-strict-mode invocation (no leaked timers).
//   3. Supports a `pause` flag for "stop the timer without
//      unsubscribing" — useful when a parent needs to gate the
//      polling on something asynchronous (e.g. an active trip).
//
// What it does NOT do:
//   - It does not fetch anything on its own. Pass a callback that
//     does the work; we only manage the timer.
//   - It does not debounce / coalesce overlapping ticks. If the
//     callback takes longer than the interval, the next tick
//     will fire on schedule. Callers that need exclusive execution
//     should guard the callback body with an `inFlight` flag.
//
// Why not just useEffect + setInterval directly:
//   The pattern below is repeated 5+ times across the app, and
//   every copy was subtly different (paused on unmount? skipped
//   on hidden tab? cleared in catch?). Centralising removes that
//   drift and makes polling testable as a unit.
// ============================================================

import { useEffect, useRef } from 'react';

export type UseIntervalOptions = {
  /** When true, the timer is not started. Default: false. */
  pause?: boolean;
};

export function useInterval(
  /** Called on every tick. Receives no arguments. */
  callback: () => void,
  /** Period in ms. */
  delayMs: number,
  { pause = false }: UseIntervalOptions = {},
): void {
  // Stash the latest callback in a ref so the timer doesn't go
  // stale if the parent re-renders with a new closure. We always
  // invoke the latest one.
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (pause) return undefined;
    if (delayMs <= 0) return undefined;

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      saved.current();
    };
    // Fire once on mount (most polling use-cases want an immediate
    // tick), then on the interval.
    run();
    const handle = window.setInterval(run, delayMs);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [delayMs, pause]);
}
