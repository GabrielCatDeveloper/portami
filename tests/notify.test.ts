// ============================================================
// Tests for the notify() helper (Hito 7 — Fase 7).
//
// jsdom doesn't ship a working Notification API or Service Worker
// registration, so we polyfill both as spies on globalThis. Each
// test installs a fresh pair to avoid bleed-through.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { notify, ensureNotificationPermission } from '@/notify';

type ShowArgs = { title: string; options: NotificationOptions };

interface MockState {
  perm: NotificationPermission;
  showCalls: ShowArgs[];
  postedMessages: Array<{ type: string; payload: unknown }>;
  swActive: boolean;
}

function installMocks(initialPerm: NotificationPermission = 'granted'): MockState {
  const state: MockState = {
    perm: initialPerm,
    showCalls: [],
    postedMessages: [],
    swActive: true,
  };

  (globalThis as any).Notification = class FakeNotification {
    static permission: NotificationPermission = initialPerm;
    static requestPermission = vi.fn(async () => {
      FakeNotification.permission = state.perm;
      return state.perm;
    });
    constructor(public title: string, public options: NotificationOptions) {
      state.showCalls.push({ title, options });
    }
  };

  // The Service Worker mock reads swActive lazily so tests can
  // toggle it mid-run to exercise the in-page fallback path.
  const sw = {
    get active() {
      return state.swActive
        ? {
            postMessage: (msg: unknown) => {
              state.postedMessages.push(msg as { type: string; payload: unknown });
            },
          }
        : null;
    },
    getRegistration: vi.fn(async function (this: unknown) {
      return { active: (sw as { active: unknown }).active };
    }),
  };
  (globalThis as any).navigator.serviceWorker = sw;
  return state;
}

function restoreGlobals() {
  delete (globalThis as any).Notification;
  delete (globalThis as any).navigator;
  // Re-install minimal navigator (some tests touch document).
  (globalThis as any).navigator = { userAgent: 'jsdom' };
}

beforeEach(() => {
  restoreGlobals();
  // Default: document visible (jsdom sets visibilityState='visible').
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('notify — foreground skip', () => {
  it('does nothing when document.visibilityState === "visible"', async () => {
    const state = installMocks('granted');
    await notify({ title: 'Hola', body: 'mundo' });
    expect(state.postedMessages).toHaveLength(0);
    expect(state.showCalls).toHaveLength(0);
  });

  it('shows notification when document is hidden', async () => {
    const state = installMocks('granted');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    await notify({ title: 'Hola', body: 'mundo' });
    expect(state.postedMessages).toHaveLength(1);
    expect(state.postedMessages[0].type).toBe('SHOW_NOTIFICATION');
    const payload = state.postedMessages[0].payload as { title: string; body: string };
    expect(payload.title).toBe('Hola');
    expect(payload.body).toBe('mundo');
  });
});

describe('notify — permission gate', () => {
  it('no-ops when permission is "denied"', async () => {
    const state = installMocks('denied');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    await notify({ title: 'Hola' });
    expect(state.postedMessages).toHaveLength(0);
    expect(state.showCalls).toHaveLength(0);
  });

  it('no-ops when Notification API is unavailable', async () => {
    delete (globalThis as any).Notification;
    // Should not throw.
    await notify({ title: 'Hola' });
    // No assertions needed — only verifying no crash.
    expect(true).toBe(true);
  });

  it('requests permission when status is "default" and proceeds if granted', async () => {
    const state = installMocks('default');
    // Simulate the user accepting the prompt.
    state.perm = 'granted';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    await notify({ title: 'Hola' });
    // Permission was 'default', notify should have called
    // requestPermission() (via the Notification class static) and
    // then posted the message if granted.
    expect(state.postedMessages).toHaveLength(1);
  });
});

describe('notify — payload passthrough', () => {
  it('passes url, requireInteraction and actions through to the SW', async () => {
    const state = installMocks('granted');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    await notify({
      title: 'Marta empezó un viaje',
      body: 'En L1',
      url: '/following',
      requireInteraction: true,
      actions: [
        { action: 'view', title: 'Ver' },
        { action: 'dismiss', title: 'Cerrar' },
      ],
      tag: 'trip-share-start-abc',
    });
    expect(state.postedMessages).toHaveLength(1);
    const payload = state.postedMessages[0].payload as Record<string, unknown>;
    expect(payload.url).toBe('/following');
    expect(payload.requireInteraction).toBe(true);
    expect(payload.actions).toEqual([
      { action: 'view', title: 'Ver' },
      { action: 'dismiss', title: 'Cerrar' },
    ]);
    expect(payload.tag).toBe('trip-share-start-abc');
  });
});

describe('notify — fallback path', () => {
  it('falls back to the in-page Notification constructor when SW is inactive', async () => {
    const state = installMocks('granted');
    state.swActive = false;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    await notify({ title: 'Hola', body: 'mundo' });
    // SW post didn't happen (no active worker).
    expect(state.postedMessages).toHaveLength(0);
    // But the in-page constructor was used.
    expect(state.showCalls).toHaveLength(1);
    expect(state.showCalls[0].title).toBe('Hola');
    expect(state.showCalls[0].options.body).toBe('mundo');
  });
});

describe('ensureNotificationPermission', () => {
  it('returns "granted" when already granted', async () => {
    installMocks('granted');
    expect(await ensureNotificationPermission()).toBe('granted');
  });

  it('returns "denied" when permission was denied', async () => {
    installMocks('denied');
    expect(await ensureNotificationPermission()).toBe('denied');
  });
});
