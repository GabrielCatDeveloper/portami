// ============================================================
// Local notifications helper
// Shows notifications via Service Worker, falls back to in-page
// ============================================================

export type NotifyPayload = {
  title: string;
  body?: string;
  tag?: string;
  url?: string;
  requireInteraction?: boolean;
};

export async function notify(payload: NotifyPayload): Promise<void> {
  // Ask for permission if needed
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') return;
  }
  if (Notification.permission !== 'granted') return;

  // Prefer SW (so it works when tab is in background)
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg?.active) {
      reg.active.postMessage({ type: 'SHOW_NOTIFICATION', payload });
      return;
    }
  }

  // Fallback: in-page notification
  try {
    new Notification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: '/icons/icon-192.png',
      data: { url: payload.url },
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