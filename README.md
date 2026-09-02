# portami

PWA anónima y colaborativa para rastrear buses y trens en tiempo real.

> Tu bus, en directo. Anónimo y colaborativo.

## Características

- **Anonimato por defecto**: cada dispositivo genera un par de claves Ed25519 que sirven como identidad estable sin cuentas ni datos personales.
- **Trazado de rutas**: graba un trayecto en bus/tren, revísalo en el mapa y guárdalo como propuesta de ruta.
- **Viajes colaborativos**: al iniciar un viaje compartes tu ubicación GPS (firmada) para que otros usuarios vean dónde está el bus.
- **Avisos contextuales**: notificación local cuando te acercas a tu parada.
- **Edición comunitaria**: cualquier usuario puede proponer cambios a una ruta. Para aplicarse se necesitan 5 aprobaciones (5 rechazos la descartan).
- **Sincronización WebRTC entre tus dispositivos**: empareja dos aparatos con QR/copia-pega y código verificador; tu identidad, rutas y propuestas se transfieren cifradas (ECDH + AES-GCM).
- **Compartir viaje con amigos (P2P multi-peer)**: al iniciar un viaje, envía la planificación y tu ubicación en directo a **N amigos emparejados simultáneamente** por WebRTC (canal de datos, sin servidor). Cada destinatario tiene estado propio (entregado / reintentando / fallido / sin conexión) y reintento manual o automático al reconectarse.
- **Fallback externo sin servidor**: si un amigo no responde por WebRTC, le envías un enlace por WhatsApp / Telegram / SMS. Cuando lo abre en portami, se reconnecta automáticamente y empieza a recibir el viaje.
- **Import/Export GeoJSON**: respalda tus rutas con un archivo GeoJSON firmado.
- **Multilenguaje**: Español, Català, English.
- **Offline-first**: rutas favoritas, identidad y viaje activo disponibles sin red.
- **WebMCP / Model Context Protocol**: la app expone **70 tools** (`document.modelContext.registerTool`) que cubren identidad, rutas, propuestas, viajes, compartición P2P, pairing, journey planning, incidents, stop alerts, settings, GPS, import/export, bus reports, rescue-me y server health. Compatible con Claude, ChatGPT, Gemini, Cursor y cualquier agente WebMCP-aware. Ver [WEBMCP.md](./WEBMCP.md).

## Stack

- Vite 5 + React 18 + TypeScript
- Leaflet + OpenStreetMap (mapas)
- idb (IndexedDB)
- Web Crypto API (Ed25519 identidad, ECDH transferencia)
- vite-plugin-pwa + Workbox (service worker, cache)
- MSW (mock API REST en desarrollo)
- i18next (i18n)
- Vitest (tests)

## Scripts

```bash
npm install        # Instalar dependencias
npm run dev        # Dev server con MSW mock
npm run build      # Build producción
npm run preview    # Servir build
npm test           # Tests unitarios
npm run typecheck  # TypeScript check
```

## Estructura

```
src/
├── api/         # cliente REST firmado + endpoints
├── components/  # UI: Map, TripBanner, icons
├── crypto/      # Web Crypto wrappers (Ed25519, ECDH, SHA-256)
├── geo/         # GPS watcher, distancia, heurística "bajó del bus"
├── io/          # GeoJSON import/export
├── i18n/        # configuración i18next (es/ca/en)
├── notify/      # helper notificaciones locales
├── pages/       # rutas: Home, Explore, RouteDetail, Trip, Record, Sync, Settings
├── state/       # Zustand stores (identity, trip)
├── storage/     # esquema IndexedDB
├── styles/      # design tokens + utilidades
├── sync/        # WebRTC peer + pairing + identity transfer
└── sw.ts        # service worker (precache, cache, notifications)

mocks/           # MSW handlers (rutas seed + REST simulado)
public/locales/  # es/, ca/, en/
tests/           # vitest unit tests
```

## Protocolo de mensajes firmados

Cada POST no-GET lleva un envelope con:
```json
{
  "pub": "<pubkey b64url>",
  "nonce": "<random b64url>",
  "ts": <unix-ms>,
  "body": <payload>,
  "sig": "<Ed25519 b64url sobre pub|nonce|ts|body>"
}
```

Canonical JSON: claves ordenadas, sin espacios, sin `undefined`.

## Pairing WebRTC

1. Device A genera offer SDP → muestra QR + texto.
2. Device B escanea el QR o pega el offer → crea answer SDP.
3. Ambos calculan `pairCode = base32(sha256(sort(pubA || pubB)))` primeros 6 chars.
4. Usuario verifica visualmente que los códigos coinciden (protección MITM).
5. ECDH efímero + AES-GCM transfiere la clave privada de usuario.
6. Diff + sync de rutas y propuestas.

## Compartir viaje con amigos

Una vez emparejado con al menos un amigo (vía el flujo de Pairing WebRTC), puedes compartirle tu viaje en directo. El envío es **siempre P2P**: ni el server ni ningún intermediario ve la planificación del viaje ni tu ubicación en directo — esos datos viajan por el canal de datos WebRTC entre tu dispositivo y el de tu amigo.

Estados por destinatario (visibles en la pantalla de viaje):

| Estado | Significado |
|---|---|
| ✓ entregado | Tu amigo ha confirmado la recepción (`trip-share-ack`) |
| ⟳ reintentando | Aún no hay ack; reintentaremos en 10s |
| ⚠ sin conexión | El amigo está desconectado ahora mismo |
| ✗ fallido | Un envío y un reintento sin respuesta. Puedes reintentar manualmente |

**Si un amigo está sin conexión**, pulsa el botón `↗` junto a su nombre para generar un enlace que puedes enviarle por WhatsApp, Telegram o SMS. Cuando lo abra en portami, se reconnectará automáticamente y empezará a recibir tu viaje (la app le mostrará la planificación completa + tu ubicación en directo, actualizada cada minuto).

Detalles del protocolo (resumido):

```
sender → receiver   trip-share-start   { tripShareId, fromAnonId, routeName, plannedRoute, startedAt }
sender → receiver   trip-share-location (cada 60s)  { tripShareId, ts, lat, lng, speed?, nextStopName?, etaNextStopS? }
sender → receiver   trip-share-end     { tripShareId, ts, reason }
receiver → sender   trip-share-ack     { tripShareId, recipientAnonId, ts, ackFor: 'start' | 'location' | 'end' }
```

El `tripShareId` se genera al iniciar el viaje y correlaciona todos los mensajes de ese envío. La persistencia es local (`outgoingTripShares` / `incomingTripShares` en IndexedDB, TTL 7 días).

## Privacidad

- Sin tracking, sin cookies, sin analytics.
- Identidad = Ed25519 keypair generado en el dispositivo; nunca abandona el dispositivo salvo que el usuario lo exporte explícitamente o lo transfiera vía WebRTC.
- Ubicación solo se comparte mientras hay un viaje activo (botón "Salir del bus" siempre visible).
- El servidor (futuro) solo recibe muestras GPS firmadas con la pubKey del usuario y los datos de la ruta.

## WebMCP (Model Context Protocol)

La PWA expone **70 tools** a través del estándar [WebMCP](https://webmachinelearning.github.io/webmcp/):
`document.modelContext.registerTool(...)`. Un agente conectado
(Claude, ChatGPT, Gemini, Cursor…) puede iniciar viajes,
compartirlos con amigos emparejados, votar propuestas, reportar
incidencias, mandar un `rescue_me`, importar/exportar GeoJSON, y
mucho más — todo desde fuera de la UI.

- Browser nativo (Chrome 146+): sin coste de bundle, la API ya está.
- Otros navegadores: `@mcp-b/global` se carga dinámicamente como
  polyfill (chunk separado, ~170 KB gzipped, solo cuando hace falta).
- Activación: siempre activo tras `init()` de la identidad.
- Tools de lectura marcados con `readOnlyHint: true`. Tools
  destructivos (`reset_identity`, `regenerate_identity`, …) sin
  marcar, para que el agente pida confirmación al usuario.

Catálogo completo en [WEBMCP.md](./WEBMCP.md).

## Roadmap

- [ ] Backend real (referencia en `mocks/handlers.ts`)
- [ ] QR scanner (cámara) en pairing
- [ ] Mapas vectoriales (MapLibre) para mejor rendimiento con muchos buses
- [ ] PWA instalable con prompt automático
- [ ] Soporte iOS Safari (Service Worker requiere "Add to Home Screen")
- [ ] Documentación del servidor y su protocolo

Ver [ROADMAP.md](./ROADMAP.md) para el plan completo, incluyendo el **Hito 7 — Compartir viaje con amigos (P2P multi-peer + fallback externo)** que ya está completado.

## Licencia

MIT