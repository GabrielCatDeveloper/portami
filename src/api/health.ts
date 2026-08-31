// ============================================================
// Server health monitoring
//
// Polls /health periodically and exposes a status the rest of the app
// can use to:
//   - decide between real-server fetch and offline fallback
//   - show a "server down" badge in the UI
//   - back off retries when the server is saturated
//
// States (mirror the server's status field):
//   normal    -> fetch from the real server
//   saturated  -> still fetch but with backoff and slower UI feedback
//   stopped   -> server unreachable right now
//   offline   -> app has been in 'stopped' for too long -> fully offline mode
//
// "offline" is not a server-defined state; we derive it locally after the
// server has been unreachable for OFFLINE_AFTER_MS.
// ============================================================

export type ServerStatus = 'normal' | 'saturated' | 'stopped' | 'offline';

const POLL_INTERVAL_MS = 30_000;
const OFFLINE_AFTER_MS = 5 * 60_000; // 5 min
const SATURATED_BACKOFF_MS = 30_000;

type Listener = (snapshot: HealthSnapshot) => void;

export type HealthSnapshot = {
  status: ServerStatus;
  lastSeenUp: number | null;   // ms timestamp; null if never
  lastCheck: number;            // ms timestamp
  attempts: number;            // consecutive poll attempts
  manualOverride: boolean;
  routes: number;
  tripsActive: number;
};

type State = HealthSnapshot & {
  /** The actual server-defined status, before our offline promotion. */
  raw: 'normal' | 'saturated' | 'stopped';
};

let state: State = {
  status: 'stopped',
  raw: 'stopped',
  lastSeenUp: null,
  lastCheck: 0,
  attempts: 0,
  manualOverride: false,
  routes: 0,
  tripsActive: 0,
};

const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l(snapshot());
}

// Memoized snapshot — `useSyncExternalStore` compares results with
// Object.is, so returning a fresh object literal every call would
// make React think the data changed on every render and trigger an
// infinite loop. We cache by `state` identity: `state` is replaced
// (immutable update) on every poll, so the cache invalidates at the
// right moment without us having to diff each field.
let cachedSnapshot: HealthSnapshot | null = null;
let cachedForState: State | null = null;

function snapshot(): HealthSnapshot {
  if (cachedSnapshot !== null && cachedForState === state) {
    return cachedSnapshot;
  }
  const { raw, lastSeenUp, lastCheck, attempts, manualOverride, routes, tripsActive } = state;
  let status: ServerStatus = raw;
  if (!manualOverride && raw === 'stopped' && lastSeenUp !== null && Date.now() - lastSeenUp > OFFLINE_AFTER_MS) {
    status = 'offline';
  }
  cachedSnapshot = { status, lastSeenUp, lastCheck, attempts, manualOverride, routes, tripsActive };
  cachedForState = state;
  return cachedSnapshot;
}

export function getHealthSnapshot(): HealthSnapshot {
  return snapshot();
}

export function subscribeHealth(fn: Listener): () => void {
  // CRITICAL: do NOT call fn(snapshot()) here. The contract for
  // subscribers (and for useSyncExternalStore in particular) is
  // "register the callback; fire it on store changes". Calling the
  // callback synchronously inside subscribe — even with the current
  // snapshot — was triggering a re-render inside React's commit
  // phase, which produced a "Maximum update depth exceeded" loop
  // (React error #185). React reads the initial value itself via
  // getSnapshot(); we don't need to push it.
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Backoff helper: when the server is saturated, returns a longer delay
// before retrying; otherwise returns 0.
export function backoffMs(): number {
  return state.raw === 'saturated' ? SATURATED_BACKOFF_MS : 0;
}

let pollHandle: number | null = null;
let pollInFlight = false;

async function poll(baseUrl: string): Promise<void> {
  if (pollInFlight) return;
  pollInFlight = true;
  state.attempts++;
  try {
    const url = baseUrl.replace(/\/$/, '') + '/health';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const newRaw: 'normal' | 'saturated' | 'stopped' =
      body.status === 'normal' || body.status === 'saturated' ? body.status : 'stopped';
    state = {
      ...state,
      raw: newRaw,
      lastSeenUp: Date.now(),
      lastCheck: Date.now(),
      manualOverride: !!body.manualOverride,
      routes: body.routes ?? 0,
      tripsActive: body.tripsActive ?? 0,
    };
  } catch {
    state = { ...state, lastCheck: Date.now() };
    // raw stays whatever it was; promote to offline after timeout in snapshot()
  } finally {
    pollInFlight = false;
    notify();
  }
}

export function startHealthPolling(baseUrl: string): void {
  if (pollHandle !== null) return;
  // First poll now, then schedule
  void poll(baseUrl);
  pollHandle = setInterval(() => void poll(baseUrl), POLL_INTERVAL_MS) as unknown as number;
}

export function stopHealthPolling(): void {
  if (pollHandle !== null) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}