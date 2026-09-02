// ============================================================
// Tests for the useInterval hook.
//
// The hook owns the setInterval lifecycle; we mock
// `window.setInterval` / `clearInterval` to assert the contract:
//   - The callback fires on mount (one initial tick).
//   - It fires every `delayMs` after that.
//   - Unmount clears the timer.
//   - `pause: true` skips the timer entirely.
//   - Latest callback is always used (no stale closure).
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useInterval } from '@/hooks/useInterval';

describe('useInterval', () => {
  let scheduled: Array<{ id: number; fn: () => void; delay: number }>;
  let clearCalls: number;

  beforeEach(() => {
    scheduled = [];
    clearCalls = 0;
    // vitest's `vi.spyOn` typing for overloaded browser globals
    // (setInterval has many overloads) doesn't compose cleanly with
    // our minimal mock — cast through `unknown` to satisfy tsc.
    vi.spyOn(window, 'setInterval').mockImplementation(
      ((fn: () => void, delay: number) => {
        const id = scheduled.length + 1;
        scheduled.push({ id, fn, delay });
        return id;
      }) as unknown as typeof window.setInterval,
    );
    vi.spyOn(window, 'clearInterval').mockImplementation(
      ((id: number) => {
        clearCalls += 1;
        scheduled = scheduled.filter((s) => s.id !== id);
      }) as unknown as typeof window.clearInterval,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fires the callback once on mount and again every `delayMs`', () => {
    const cb = vi.fn();
    renderHook(() => useInterval(cb, 1000));

    // Mount ticks once.
    expect(cb).toHaveBeenCalledTimes(1);
    // A timer was scheduled for the recurring ticks.
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delay).toBe(1000);

    // Manually fire the scheduled callback (the mock doesn't run
    // timers automatically).
    scheduled[0]?.fn();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('clears the interval on unmount', () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useInterval(cb, 1000));
    expect(clearCalls).toBe(0);
    unmount();
    expect(clearCalls).toBe(1);
    expect(scheduled).toHaveLength(0);
  });

  it('skips starting the timer when `pause: true`', () => {
    const cb = vi.fn();
    renderHook(() => useInterval(cb, 1000, { pause: true }));
    // The initial tick is also skipped under pause.
    expect(cb).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
  });

  it('uses the latest callback across re-renders (no stale closure)', () => {
    const calls: number[] = [];
    const { rerender } = renderHook(
      ({ n }: { n: number }) => {
        useInterval(() => {
          calls.push(n);
        }, 1000);
      },
      { initialProps: { n: 1 } },
    );

    expect(calls).toEqual([1]);

    // Re-render with a new n. The delayMs didn't change, so the
    // timer is not cleared. But the *latest* callback (capturing
    // the new `n`) is the one that runs on the next tick — that's
    // the "no stale closure" guarantee.
    rerender({ n: 42 });
    // The original setInterval is still scheduled; fire it.
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.fn();
    expect(calls).toEqual([1, 42]);
  });

  it('does not start a timer when `delayMs` is 0 or negative', () => {
    const cb = vi.fn();
    renderHook(() => useInterval(cb, 0));
    expect(scheduled).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});