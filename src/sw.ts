/// <reference lib="webworker" />

// ============================================================
// portami Service Worker
// Strategy:
//  - Precached app shell (handled by vite-plugin-pwa)
//  - Runtime cache for OSM tiles (CacheFirst, 7d expiry)
//  - Runtime cache for /api GETs (NetworkFirst)
//  - Notification handler
//
// IMPORTANT: all asset URLs (icons, navigation) are resolved against
// self.registration.scope so the SW works under any base path
// (GitHub Pages /portami/, custom domain /, etc.).
//
// Bump CACHE_VERSION whenever the SW logic changes in a way that requires
// all clients to drop their old runtime caches.
// ============================================================

import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope;

// Increment whenever the SW logic changes in a way that requires all
// clients to drop their old runtime caches. Bumped to v22: second
// fix for React error #185 (the production deploy of v21 still
// looped because subscribeHealth's immediate-on-subscribe callback
// scheduled a render inside React's commit phase; the v22 build
// drops that callback entirely).
const CACHE_VERSION = 22;

self.skipWaiting();
clientsClaim();

// Base path resolved at runtime — works on GitHub Pages (/portami/) or domain root (/)
const BASE = new URL('./', self.registration?.scope ?? self.location.href).href;
const iconUrl = (size: 192 | 512) => new URL(`icons/icon-${size}.png`, BASE).href;

// Precache manifest injected by vite-plugin-pwa
precacheAndRoute(self.__WB_MANIFEST);

// Cache OSM tiles aggressively (read-only, stable)
registerRoute(
  ({ url }) =>
    url.hostname.endsWith('tile.openstreetmap.org') ||
    url.hostname.endsWith('basemaps.cartocdn.com'),
  new CacheFirst({
    cacheName: `portami-tiles-v${CACHE_VERSION}`,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 4000,
        maxAgeSeconds: 7 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

// API GETs: network first, fallback to cache
registerRoute(
  ({ url, request }) => url.pathname.startsWith('/api/') && request.method === 'GET',
  new NetworkFirst({
    cacheName: `portami-api-v${CACHE_VERSION}`,
    networkTimeoutSeconds: 4,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 24 * 60 * 60,
      }),
    ],
  }),
);

// ============================================================
// Notifications — triggered from client via postMessage
// ============================================================
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type: string; payload?: any };
  if (!data || !data.type) return;

  if (data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, url, requireInteraction, actions } =
      data.payload ?? {};
    void self.registration.showNotification(title ?? 'portami', {
      body: body ?? '',
      tag: tag ?? 'portami',
      icon: iconUrl(192),
      badge: iconUrl(192),
      data: { url },
      requireInteraction: !!requireInteraction,
      // Action buttons — at most 2 visible (browser limit). The
      // receiver side defines "view" and "dismiss"; the SW handles
      // them in `notificationclick`.
      actions: Array.isArray(actions) ? actions.slice(0, 2) : undefined,
      ...({ vibrate: [120, 60, 120] } as any),
    });
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data?.url as string) ?? BASE;

  // If the user explicitly tapped "dismiss", do nothing more.
  if (event.action === 'dismiss') {
    return;
  }

  // Default click or explicit "view" action → focus existing window
  // and tell the app to navigate to the target URL.
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((wins) => {
        for (const w of wins) {
          if ('focus' in w) {
            w.focus();
            w.postMessage({ type: 'NAVIGATE', payload: { url: targetUrl } });
            return;
          }
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});

export {};