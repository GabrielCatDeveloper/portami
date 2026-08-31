// ============================================================
// Local notifications helper
// Shows notifications via Service Worker, falls back to in-page.
//
// Behaviour (Hito 7 — Fase 7):
//   - Foreground: skip if the document is visible; the in-app UI
//     reacts to the same event so a notification would be noise.
//   - Background: post a message to the active Service Worker which
//     shows the notification via registration.showNotification (works
//     when the tab is hidden, on mobile, etc.).
//   - Falls back to the in-page Notification constructor when the SW
//     isn't ready yet (e.g. first launch).
//   - Action buttons are passed through to the SW, which includes
//     them in showNotification and handles the `view` action by
//     sending a `NAVIGATE` message to the focused client (or opening
//     a new window).
// ============================================================

export type NotifyAction = {
  /** Action id (e.g. "view", "dismiss"). The SW routes on this. */
  action: string;
  /** Visible label. */
  title: string;
};

export type NotifyPayload = {
  title: string;
  body?: string;
  tag?: string;
  /** URL to open when the user clicks the notification or the
   *  "view" action. */
  url?: string;
  requireInteraction?: boolean;
  /** Optional action buttons. */
  actions?: NotifyAction[];
};

/**
 * Show a notification. No-op when:
 *   - the Notification API is unavailable,
 *   - permission isn't granted,
 *   - the document is visible (foreground UI already covers this case).
 */
export async function notify(payload: NotifyPayload): Promise<void> {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') return;
  }
  if (Notification.permission !== 'granted') return;

  // Foreground: skip. The in-app UI (zustand store + Following page)
  // already updates reactively. Showing a system notification on top
  // would be noise and, on mobile, distracting.
  if (
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible'
  ) {
    return;
  }

  // Prefer SW (works when tab is hidden / on mobile).
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg?.active) {
      reg.active.postMessage({ type: 'SHOW_NOTIFICATION', payload });
      return;
    }
  }

  // Fallback: in-page Notification constructor.
  try {
    new Notification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url },
      requireInteraction: payload.requireInteraction,
      // Notification.actions isn't in the lib.dom.d.ts on every TS
      // version we target, so cast through `unknown`.
      ...({ actions: payload.actions } as object),
    });
  } catch {
    // ignore
  }
}

export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  return await Notification.requestPermission();
}