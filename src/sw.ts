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

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope;

// Increment whenever the SW logic changes in a way that requires all
// clients to drop their old runtime caches. Bumped to v27: apiFetch
// now prepends /api to every call, aligning with the server's route
// prefix. Previously the app called /routes/nearby, /incidents etc.
// while the real server (and MSW) registered them at /api/routes/nearby,
// /api/incidents, so every list call returned 404.
const CACHE_VERSION = 28;

self.skipWaiting();
clientsClaim();

// workbox-precaching injects a precache manifest with revision hashes.
// `cleanupOutdatedCaches` deletes entries whose revision no longer
// matches the current build — this prevents stale app-shell bundles
// from being served after a deployment, especially on devices that
// skip the upgrade flow (e.g. iOS PWAs with no network for hours).
cleanupOutdatedCaches();

// Belt-and-braces: also wipe any leftover runtime caches that follow
// the old `portami-*-v<old>` naming pattern. `ExpirationPlugin` handles
// TTL-based eviction, but explicit deletion here protects against the
// case where we bump CACHE_VERSION and the user comes back months
// later — the old `portami-tiles-v27` cache would otherwise linger
// in storage until the 7-day TTL elapses.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keepTiles = `portami-tiles-v${CACHE_VERSION}`;
      const keepApi = `portami-api-v${CACHE_VERSION}`;
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => (k.startsWith('portami-tiles-v') || k.startsWith('portami-api-v')) && k !== keepTiles && k !== keepApi)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

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
type NotifyPayloadFromClient = {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
  requireInteraction?: boolean;
  actions?: Array<{ action: string; title: string }>;
};

type ClientMessage =
  | { type: 'SHOW_NOTIFICATION'; payload?: NotifyPayloadFromClient }
  | { type: 'NAVIGATE'; payload?: { url?: string } };

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as ClientMessage | undefined;
  if (!data || !data.type) return;

  if (data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, url, requireInteraction, actions } =
      data.payload ?? {};
    // `actions` and `vibrate` are not in the standard `NotificationOptions`
    // type but are widely supported by browsers. Cast through `unknown`
    // to satisfy TS without losing the data.
    const options = {
      body: body ?? '',
      tag: tag ?? 'portami',
      icon: iconUrl(192),
      badge: iconUrl(192),
      data: { url },
      requireInteraction: !!requireInteraction,
      actions: Array.isArray(actions) ? actions.slice(0, 2) : undefined,
      vibrate: [120, 60, 120],
    } as unknown as NotificationOptions & { actions?: unknown; vibrate?: number[] };
    void self.registration.showNotification(title ?? 'portami', options);
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