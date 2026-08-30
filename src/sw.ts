/// <reference lib="webworker" />

// ============================================================
// portami Service Worker
// Strategy:
//  - Precached app shell (handled by vite-plugin-pwa)
//  - Runtime cache for OSM tiles (CacheFirst, 7d expiry)
//  - Runtime cache for /api GETs (NetworkFirst, fallback to IndexedDB on SW side handled by client)
//  - Notification handler
// ============================================================

import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();

// Precache manifest injected by vite-plugin-pwa
precacheAndRoute(self.__WB_MANIFEST);

// Cache OSM tiles aggressively (read-only, stable)
registerRoute(
  ({ url }) =>
    url.hostname.endsWith('tile.openstreetmap.org') ||
    url.hostname.endsWith('basemaps.cartocdn.com'),
  new CacheFirst({
    cacheName: 'portami-tiles-v1',
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
    cacheName: 'portami-api-v1',
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
    const { title, body, tag, url, requireInteraction } = data.payload ?? {};
    void self.registration.showNotification(title ?? 'portami', {
      body: body ?? '',
      tag: tag ?? 'portami',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url },
      requireInteraction: !!requireInteraction,
      ...({ vibrate: [120, 60, 120] } as any),
    });
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data?.url as string) ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
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