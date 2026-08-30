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
- **Import/Export GeoJSON**: respalda tus rutas con un archivo GeoJSON firmado.
- **Multilenguaje**: Español, Català, English.
- **Offline-first**: rutas favoritas, identidad y viaje activo disponibles sin red.

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

## Privacidad

- Sin tracking, sin cookies, sin analytics.
- Identidad = Ed25519 keypair generado en el dispositivo; nunca abandona el dispositivo salvo que el usuario lo exporte explícitamente o lo transfiera vía WebRTC.
- Ubicación solo se comparte mientras hay un viaje activo (botón "Salir del bus" siempre visible).
- El servidor (futuro) solo recibe muestras GPS firmadas con la pubKey del usuario y los datos de la ruta.

## Roadmap

- [ ] Backend real (referencia en `mocks/handlers.ts`)
- [ ] QR scanner (cámara) en pairing
- [ ] Mapas vectoriales (MapLibre) para mejor rendimiento con muchos buses
- [ ] PWA instalable con prompt automático
- [ ] Soporte iOS Safari (Service Worker requiere "Add to Home Screen")
- [ ] Documentación del servidor y su protocolo

## Licencia

MIT