# portami — roadmap

## Estado actual (noviembre 2026)

App PWA desplegada en GitHub Pages. El server vive en un repo hermano
`../portami-server` (Deno Deploy). Su URL canónica de producción está
en `.env.example` y en `.github/workflows/prod.yml` (variable de
entorno `VITE_API_BASE`); si el server se redeploya bajo otro
hostname, hay que actualizar **esos dos sitios** y este roadmap
queda obsoleto en la línea siguiente. Última URL conocida:
`https://portami-server-6mv9bn5jhvvb.gabrielcatdev.deno.net/`.

- Idioma: es / ca / en
- Identidad anónima (Ed25519), backup cifrado con passphrase
- Import/Export GeoJSON firmado
- WebRTC P2P entre dispositivos emparejados (clave + propuestas + rutas + compartir viaje con GPS cada 60s)
- **Compartir viaje con amigos**: multi-peer, ack por destinatario, retry automático al reconectar, invitación externa por WhatsApp/Telegram/SMS (deeplink sin servidor)
- Notificaciones locales con action buttons (llegada a parada, propuestas aprobadas, alertas fuertes, viajes compartidos con `requireInteraction`)
- Modo demo para grabación sin GPS
- Modo offline cuando el server lleva > 5 min caído
- Health store que polea /health y refleja el estado del server

## Hitos completados

- [x] Hito 0 — Mock API (MSW) y contrato REST con la app
- [x] Hito 1 — WebRTC sync entre pares (clave + entidades)
- [x] Hito 2 — Alertas de parada (tráfico-aware, vibración+sonido)
- [x] Hito 3 — Board / Record con editor de vehículo y horario
- [x] Hito 4 — Incidents + Bus reports + Stop request (colaborativo)
- [x] Hito 5 — Planificador A→B (cliente llama server /api/journey-plan)
- [x] Hito 6 — Live tracking WebRTC entre amigos emparejados
- [x] Hito 7 — Compartir viaje con amigos (P2P multi-peer + fallback externo)

## Persistencia — roadmap

Hoy `t.activeTrip` y `t.plannedRoute` son volátiles en memoria. El usuario quiere que esta información persista. Roadmap en dos partes:

### App (IndexedDB + estado del server)

1. **Persistencia local del viaje activo** en IndexedDB (store nuevo `trips` o ampliación del `trips` actual):
   - Al iniciar un viaje, persistir `{ activeTrip, plannedRoute, lastSample }` con TTL 24h.
   - Al montar la app, si hay un viaje activo persistido, ofrecer "reanudar viaje".
   - El GPS sigue funcionando en background (navigator.geolocation.watchPosition).
2. **Notificaciones aunque la app esté cerrada** (Service Worker + Notification API).
3. **Subir snapshot del viaje al server** (`POST /api/trips/:id/state`) periódicamente — esto permite reanudar desde otro dispositivo.
4. **TTL**: borrar de IndexedDB los viajes de más de 7 días.

### Server (portami-server) — parte de la persistencia

Ver `../portami-server/ROADMAP.md` sección "Hito 4 — Persistencia de viajes (servidor)".

---

## Hito 7 — Compartir viaje con amigos (P2P multi-peer + fallback externo)

### Principio arquitectónico

**El servidor nunca ve los datos del viaje.** El envío de planificación y ubicación en directo entre el usuario y sus amigos se hace **siempre** por WebRTC P2P (canal de datos), dispositivo → dispositivo, sin pasar por ningún intermediario. El servidor solo recibe muestras GPS anónimas y firmadas para el live tracking público del bus (que es otra cosa, no el "compartir con amigos").

Cuando un amigo no está conectado por WebRTC (app cerrada, sin internet, batería baja), el usuario:

1. Ve el **estado por destinatario** (entregado / pendiente / fallido / sin conexión).
2. Puede **reintentar manualmente** pulsando un botón.
3. Como último recurso, puede **invitar al amigo por otra app** (WhatsApp, Telegram, SMS) enviándole un enlace. Cuando el amigo abre el enlace en portami, se reconnecta automáticamente y empieza a recibir la planificación + ubicación.

El enlace de invitación contiene un **offer SDP pre-generado** (no requiere que el amigo esté ya conectado), y codifica también el `anonId` del emisor para que portami del amigo pueda identificarlo y emparejarlo si aún no lo estaba.

### Estado actual (gap analysis)

| Funcionalidad | Estado actual | Necesario |
|---|---|---|
| Pairing 1-a-1 por WebRTC | ✅ implementado en `sync/index.ts` y `pages/Sync.tsx` | Se mantiene como está |
| Conexión persistente post-pairing | ❌ `p.close()` se llama tras `sync-entities` | Mantener conexiones vivas |
| Soporte multi-fanout (N amigos) | ❌ solo `let peer: Peer \| null = null;` | Map<deviceId, Peer> |
| Estado de cada peer | ❌ no hay tracking | `peers: Record<deviceId, PeerStatus>` |
| Acuse de recibo por mensaje | ❌ no existe | `trip-share-ack` en protocolo |
| Reintento manual | ❌ no existe | botón por destinatario |
| Fallback externo (deeplink) | ❌ no existe | URL con offer SDP pre-generado |
| Persistencia de viajes recibidos | ❌ solo en memoria (`sharedTrips` en zustand) | IndexedDB store |
| Persistencia del emisor (a quién he enviado qué) | ❌ no existe | IndexedDB store |
| Notificación push al receptor | parcial — solo foreground | SW + Notification API |

### Roadmap paso a paso

Cada fase tiene: objetivo, archivos a tocar, criterios de aceptación, tests mínimos, tiempo estimado.

---

#### Fase 0 — Decisiones de diseño

**Objetivo**: cerrar las decisiones que afectan a toda la arquitectura antes de tocar código.

**Decisiones a tomar**:

1. **Formato del deeplink de invitación**.
   - Candidato: `https://portami.app/connect?o=<base64url(offer-sdp)>&u=<my-anonId>&a=<alias>&v=1`
   - `o`: offer SDP pre-generado (JSON `{type:'offer', sdp:{...}}` codificado en base64url).
   - `u`: anonId del emisor (para que el receptor pueda mostrar "X te está invitando").
   - `a`: alias legible del emisor.
   - `v`: versión del esquema (para evolucionar).
2. **Cómo vuelve el `answer` SDP al emisor** (cuando el amigo abre el deeplink):
   - **Opción A (MVP, sin servidor)**: el amigo abre el enlace, portami genera el `answer` y se lo muestra para que lo copie y lo envíe por la misma app externa (WhatsApp) de vuelta. Esto es feo pero funciona sin tocar el server.
   - **Opción B (recomendada, requiere server)**: portami-server actúa como **relay de signalling** (solo SDP, nunca ve mensajes de viaje). El amigo abre el deeplink → su portami sube el `answer` al server → el emisor lo descarga automáticamente y cierra la conexión WebRTC.
   - Decidir A o B antes de empezar Fase 6.
3. **Identificador de dispositivo**: usar `deviceKey.pubKey` como ID estable (es lo que ya hace `pairedDevices`). Si el amigo reinstala portami, su deviceKey cambia y tendrá que re-emparejar (documentado).
4. **Ventana de validez del offer pre-generado**: los SDP incluyen ICE candidates que pueden expirar. Generar el offer **on-demand** cuando el usuario pulsa "invitar" (no pre-cachear). TTL de 5 min en el offer: si el amigo abre el link pasadas 5 min, portami le pide al emisor que genere uno nuevo (esto requiere signalling).
5. **Qué hacer con la identity (clave Ed25519 de usuario) en el deeplink**: nada — la identity no viaja en el deeplink. Se transfiere por WebRTC igual que en el pairing inicial (mensaje `identity-transfer`).

**Salida**: documento de 1 página en `docs/connect-deeplink.md` con las decisiones cerradas.

**Tiempo**: 0.5–1 día.

---

#### Fase 1 — Multi-peer en el sync store (refactor)

**Objetivo**: que `useSyncStore` mantenga conexiones WebRTC persistentes con N pares simultáneamente, con estado observable por peer.

**Archivos a tocar**:
- `src/sync/index.ts` — refactor principal.
- `src/sync/peer.ts` — sin cambios (la clase `Peer` ya es reusable).
- `src/api/types.ts` — añadir `PeerStatus` y `SyncMessage` nuevos tipos.

**Cambios concretos**:

1. Reemplazar `let peer: Peer | null = null` por `const peers = new Map<deviceId, Peer>()`.
2. Añadir tipos:
   ```ts
   export type PeerStatus =
     | 'disconnected'   // nunca conectado o cerrado
     | 'connecting'     // SDP exchange en curso
     | 'connected'      // data channel abierto
     | 'reconnecting'   // ICE falló, reintento
     | 'unreachable'    // últimos N intentos fallaron
     | 'revoked';       // emparejamiento eliminado
   ```
3. Estado en el store:
   ```ts
   peers: Record<deviceId, { peer: Peer; status: PeerStatus; lastConnectedAt?: number; lastError?: string }>;
   ```
4. API nueva (mantener compatibilidad con `send`/`subscribe` actuales):
   ```ts
   send(msg: SyncMessage): void;                       // broadcast a todos los conectados (compat)
   sendTo(deviceId: string, msg: SyncMessage): void;   // a uno concreto
   subscribe(fn): unsubscribe;                          // todos los mensajes de todos los peers (compat)
   subscribeToDevice(deviceId, fn): unsubscribe;        // uno concreto
   getPeerStatus(deviceId: string): PeerStatus;
   listConnectedPeers(): deviceId[];
   ```
5. **No cerrar** el peer tras `sync-entities`. Las conexiones quedan vivas.
6. **Cleanup**: al hacer `reset()`, cerrar todos los peers.

**Criterios de aceptación**:
- [ ] Emparejar 3 dispositivos secuencialmente con el mismo "host" deja 3 conexiones `connected` simultáneas en el store.
- [ ] `getPeerStatus('dev-1')` devuelve `'connected'` mientras el peer sigue abierto.
- [ ] Cerrar la pestaña del peer-1 marca el status como `'disconnected'` en el host vía `iceconnectionstatechange`.
- [ ] `subscribeToDevice('dev-2', fn)` solo recibe mensajes del peer dev-2.
- [ ] `sendTo('dev-2', {kind:'ping', ts:1})` llega solo al peer dev-2.

**Tests**: añadir en `tests/multiPeer.test.ts` con peers simulados (RTCPeerConnection mock o 2 PeerContexts en el mismo proceso).

**Tiempo**: 2–3 días.

---

#### Fase 2 — Schema IndexedDB para tracking de entregas

**Objetivo**: persistir (a) los viajes que he enviado y a quién, y (b) los viajes que me han compartido. Esto permite que el emisor sepa el historial y que el receptor vea viajes recibidos aunque haya cerrado la app.

**Archivos a tocar**:
- `src/storage/db.ts` — bump `DB_VERSION` a 2, nuevos stores.
- `src/api/types.ts` — nuevos tipos.

**Stores nuevos**:

```ts
// Viajes que YO he enviado a amigos
outgoingTripShares: {
  key: string; // tripShareId = uuid
  value: OutgoingTripShare;
  indexes: { 'by-startedAt': number; 'by-trip': string };
};
type OutgoingTripShare = {
  id: string; // tripShareId
  tripId: string;
  routeId: string;
  routeName: string;
  plannedRoute?: PlannedRouteSummary;
  startedAt: number;
  endedAt?: number;
  myAnonId: string;
  recipients: Record<deviceId, {
    peerAnonId?: string;
    alias?: string;
    status: 'pending' | 'delivered' | 'failed' | 'unreachable';
    lastAttemptAt: number;
    deliveredAt?: number;
    error?: string;
  }>;
};

// Viajes que ME han compartido
incomingTripShares: {
  key: string; // fromAnonId (un viaje activo por emisor)
  value: IncomingTripShare;
  indexes: { 'by-startedAt': number };
};
type IncomingTripShare = {
  fromAnonId: string;
  fromAlias?: string;
  fromDeviceId: string; // deviceKey.pubKey del emisor
  tripId: string;
  routeId?: string;
  routeName?: string;
  plannedRoute?: PlannedRouteSummary;
  startedAt: number;
  endedAt?: number;
  endReason?: string;
  lastLocation?: LatLng & { ts: number; speed?: number };
  nextStopName?: string;
  etaNextStopS?: number;
};
```

**Migración**: añadir al `upgrade()` en `db.ts`. Versionado a 2, copiar datos existentes si los hay (no hay stores que cambien de schema en este hito, solo añadir).

**TTL**: tarea de mantenimiento en `useEffect` del `App.tsx` (o en un nuevo `useStorageJanitor`): borrar `outgoingTripShares` con `startedAt < now() - 7d` y `incomingTripShares` con `endedAt < now() - 7d`. Ejecutar al montar la app y cada 24h.

**Criterios de aceptación**:
- [ ] La DB se abre en v2 sin errores en un perfil con DB v1 existente.
- [ ] CRUD básico funciona: put/get/delete en cada store nuevo.
- [ ] El janitor borra registros caducados.

**Tests**: integration test con `fake-indexeddb` (ya en `tests/setup.ts` o similar).

**Tiempo**: 1 día.

---

#### Fase 3 — Protocolo: acuse de recibo (`trip-share-ack`)

**Objetivo**: que el receptor confirme que ha recibido el `trip-share-start` (y opcionalmente cada `trip-share-location`) para que el emisor pueda mostrar "entregado ✓" en la UI.

**Archivos a tocar**:
- `src/api/types.ts` — extender `SyncMessage`.

**Cambios**:

1. Añadir campo `tripShareId: string` a `trip-share-start`, `trip-share-location` y `trip-share-end`. Es un UUID generado por el emisor al arrancar el viaje; permite correlacionar los acks.
2. Nuevo mensaje:
   ```ts
   | { kind: 'trip-share-ack'; tripShareId: string; recipientAnonId: string; ts: number; ackFor: 'start' | 'location' | 'end' }
   ```
3. Acuse de `start` es obligatorio (cambia el status a `delivered`).
4. Acuse de `location` opcional (no se usa para status, solo para métricas/debug).
5. Acuse de `end` opcional.

**Semántica del emisor**:
- Al enviar `trip-share-start`, marcar el destinatario como `pending` con `lastAttemptAt = now()`.
- Si llega `trip-share-ack` con `ackFor: 'start'`, marcar `delivered` con `deliveredAt = now()`.
- Si pasan 10 s sin ack y el peer sigue `connected`, reintentar una vez (reenviar `start`). Si pasa otra vez, marcar `failed`.
- Si el peer está `unreachable`/`disconnected` desde el principio, marcar `unreachable` directamente (no es `failed`).

**Tiempo**: 0.5 día (solo tipos + lógica de emisor en `useTripShareBridge`).

---

#### Fase 4 — `useTripShareBridge` multi-fanout

**Objetivo**: que iniciar un viaje y compartirlo envíe el planning a todos los paired devices en paralelo, con estado por destinatario.

**Archivos a tocar**:
- `src/sync/tripShare.ts` — refactor principal.
- `src/state/tripShare.ts` — añadir estado `outgoing: OutgoingTripShare | null` (sustituye al actual `outgoing: SharedTrip` plano).

**Cambios**:

1. `startSharing()`:
   - Genera `tripShareId = uuid()`.
   - Persiste `outgoingTripShares[id]` con `recipients` vacío.
   - Por cada deviceId en `pairedDevices`:
     - `status = peerStatus(deviceId)`.
     - Si `connected` → enviar `trip-share-start` con `tripShareId` → marcar `pending`.
     - Si `disconnected`/`unreachable` → marcar `unreachable` (no enviar).
   - Devuelve `OutgoingTripShare`.
2. Loop de `trip-share-location` cada 60 s:
   - Enviar a todos los `connected`.
   - Si entre envíos un peer pasa a `connected` y estaba `unreachable`, reenviar `start` automáticamente (catch-up).
3. `stopSharing(reason)`:
   - Enviar `trip-share-end` a todos los `connected`.
   - Marcar `endedAt` en `outgoingTripShares`.
4. Hook `useTripShareBridge` devuelve:
   ```ts
   {
     startSharing: () => Promise<OutgoingTripShare>;
     stopSharing: (reason?: string) => void;
     retryRecipient: (deviceId: string) => Promise<void>;   // nuevo
     getRecipients: () => Record<deviceId, RecipientStatus>;
   }
   ```
5. `updateSharedTrip` en el store de incoming: si llega `trip-share-start`, persistir en `incomingTripShares` y mostrar notificación local.

**Criterios de aceptación**:
- [ ] Empezar un viaje con 3 amigos emparejados, 1 conectado y 2 sin conexión → UI muestra: ✓ entregado, ⚠ sin conexión, ⚠ sin conexión.
- [ ] Cuando el amigo 2 abre portami y se conecta → el emisor le reenvía `start` automáticamente y su estado pasa a ⟳ pending → ✓ delivered (ack).
- [ ] El receptor, al recibir `trip-share-start`, ve el viaje en `/following` aunque cierre y reabra portami.

**Tests**: `tests/tripShareMulti.test.ts` con 3 peers simulados, validar ack timeout y reintento.

**Tiempo**: 2 días.

---

#### Fase 5 — UI de Trip: panel de destinatarios

**Objetivo**: en la pantalla de viaje, mostrar una lista con cada amigo emparejado, su estado de entrega del share, y acciones (reintentar / invitar por otra app).

**Archivos a tocar**:
- `src/pages/Trip.tsx` — sustituir la card "Compartir viaje" actual.
- `src/components/TripSharePanel.tsx` — nuevo componente.
- `src/styles/` — clases nuevas si hacen falta (chips de estado).

**UI propuesta**:

```
┌─────────────────────────────────────────────┐
│ Compartir viaje con mis amigos        [ⓘ]  │
├─────────────────────────────────────────────┤
│ [✓] Marta          entregado · hace 12 s  │
│ [⟳] Carlos         reintentando…           │
│ [⚠] Lucía          sin conexión     [↻][📤]│
│ [⚠] Pablo          sin conexión     [↻][📤]│
├─────────────────────────────────────────────┤
│ [ Compartir con otros amigos emparejados ] │
└─────────────────────────────────────────────┘
```

- **Selector inicial**: al primer "compartir", mostrar modal con checkboxes de los paired devices (por defecto, los conectados).
- **Estado por destinatario**: chip con icono + texto corto. Colores:
  - `delivered` → verde `var(--success)`
  - `pending` → amarillo `var(--warning)`
  - `failed` → rojo `var(--danger)`
  - `unreachable` → gris `var(--muted)`
- **Acciones por destinatario**:
  - `↻` reintentar: solo visible si `failed`/`unreachable`.
  - `📤` invitar por otra app: visible si `unreachable` (o siempre, como atajo). Abre modal de Fase 6.
- **Resumen arriba**: "Compartido con 2 de 4 amigos".

**Criterios de aceptación**:
- [ ] La UI refleja el estado en tiempo real (sin recargar).
- [ ] Reintentar un destinatario `failed` cambia su estado a `pending` y, si el peer está conectado, a `delivered`.
- [ ] El botón "invitar por otra app" abre el modal correspondiente.

**Tiempo**: 1 día.

---

#### Fase 6 — Fallback externo: deeplink + invite por WhatsApp/Telegram/SMS

**Objetivo**: si un amigo no tiene conexión WebRTC, el emisor puede enviarle un enlace por otra app. Al abrirlo, el amigo entra a portami, se reconnecta automáticamente, y empieza a recibir el viaje.

**Archivos a tocar**:
- `src/sync/invite.ts` — nuevo. Genera y parsea deeplinks.
- `src/components/InviteModal.tsx` — nuevo. UI para elegir app + pre-rellenar mensaje.
- `src/pages/Connect.tsx` — nuevo. Maneja la ruta `/connect?o=...`.
- `src/App.tsx` — añadir la ruta.
- `public/locales/{es,ca,en}/common.json` — textos i18n.

**Cambios**:

1. **Generación del offer SDP**:
   - `createInviteLink(recipientAlias)`:
     - Crea un `RTCPeerConnection` efímero (no es un peer "real", solo queremos el SDP).
     - Crea un `RTCDataChannel` para forzar ICE candidates.
     - `createOffer()` → espera ICE gathering (`onicecandidate` hasta `pc.iceGatheringState === 'complete'`).
     - Codifica `{type:'offer', sdp: offer}` en base64url.
     - **Importante**: este RTCPeerConnection NO se usa para enviar datos, solo para fabricar el SDP. Se cierra inmediatamente. Los mensajes de viaje seguirán usando el `Peer` normal que se establecerá cuando el amigo responda.
2. **Formato del enlace** (cerrado en Fase 0):
   ```
   https://portami.app/connect?o=<base64url-offer>&u=<emitter-anonId>&a=<alias>&t=<tripShareId>&v=1
   ```
   - `o`: offer SDP.
   - `u`: anonId del emisor.
   - `a`: alias legible.
   - `t`: tripShareId al que se está uniendo (para que el receptor sepa qué viaje va a recibir).
   - `v`: versión del esquema.
3. **Texto pre-relleno por idioma**:
   - es: *"Ey, ábreme portami y te comparto mi viaje en directo: <url>"*
   - ca: *"Ep, obre'm portami i comparteixo el meu viatge en directe: <url>"*
   - en: *"Hey, open portami and I'll share my trip with you live: <url>"*
4. **Web Share API + fallback a intents**:
   ```ts
   if (navigator.share) {
     await navigator.share({ text, url });
   } else {
     // Mostrar modal con botones: WhatsApp, Telegram, SMS, Copiar
     const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
     const tg = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
     const sms = `sms:?body=${encodeURIComponent(text)}`;
   }
   ```
5. **Ruta `/connect`** (`pages/Connect.tsx`):
   - Parsea query params.
   - Si portami no está abierto en este dispositivo → "Instala portami para continuar" + CTA a la PWA.
   - Si está abierto:
     - Llama a `useSyncStore().acceptInviteLink(o, u, a)` que:
       - Crea un Peer como `joiner` con el offer.
       - Genera el answer.
       - **Si Opción A (MVP)**: muestra el answer al usuario para que lo copie y lo envíe de vuelta por WhatsApp.
       - **Si Opción B (server relay)**: sube el answer a `/api/connect/answer` y el emisor lo descarga por polling/WebSocket.
     - Al establecerse la conexión, el receptor recibe el `trip-share-start` que se había enviado.
     - Notificación: "Te has conectado con {alias}, te va a compartir su viaje".
6. **Marcar la entrega**: cuando el receptor abre el deeplink y se conecta, el emisor recibe el `trip-share-ack` y marca el destinatario como `delivered`.

**Criterios de aceptación**:
- [ ] En la UI de Trip, el botón "📤 invitar" abre el modal con WhatsApp/Telegram/SMS/Copiar.
- [ ] Al pulsar WhatsApp (o Web Share), se abre la app con el texto pre-relleno y el enlace.
- [ ] Al abrir el enlace en otro dispositivo con portami, se completa la conexión y el viaje aparece en `/following` del receptor.
- [ ] Si el enlace tiene `v` desconocido, se ignora silenciosamente y muestra un error.
- [ ] Si el offer SDP ha expirado (>5 min), el receptor ve "El enlace ha caducado, pide uno nuevo" y el emisor recibe un mensaje push/visual para regenerarlo.

**Tests**: 
- Unit: `tests/invite.test.ts` — encode/decode del URL.
- E2E manual: dos dispositivos, simular uno offline → invitar por WhatsApp → abrir enlace → recibir viaje.

**Tiempo**: 2–3 días (depende de si se elige Opción A o B en Fase 0).

---

#### Fase 7 — Notificaciones push al receptor

**Objetivo**: que el receptor sepa que está recibiendo un viaje compartido aunque tenga portami cerrada o en background.

**Archivos a tocar**:
- `src/notify/index.ts` — usar `registration.showNotification` desde el SW.
- `src/sw.ts` — manejar mensajes push y `notificationclick`.
- `src/sync/tripShare.ts` — cuando llega `trip-share-start`, llamar a `notify()` con `requireInteraction: true` (ya se hace, verificar).

**Cambios**:

1. Cuando llega `trip-share-start` y `document.visibilityState !== 'visible'`, el Service Worker muestra una notificación local con:
   - Título: `{alias} empezó un viaje`
   - Body: ruta planeada (resumen) o "Comparte ubicación cada minuto".
   - Tag: `trip-share-start-{fromAnonId}` (sustituye a la previa).
   - `requireInteraction: true` (no se autocierra).
   - `actions: [{ action: 'view', title: 'Ver' }, { action: 'dismiss', title: 'Cerrar' }]`.
2. `notificationclick` action `view` → `clients.openWindow('/following')`.
3. Si la app está en foreground, no mostrar notificación (ya tenemos UI reactiva).

**Criterios de aceptación**:
- [ ] Con portami cerrada en el receptor, llega `trip-share-start` (forzado vía deeplink) → aparece notificación.
- [ ] Click en la notificación abre `/following`.
- [ ] Con portami abierta, no aparece notificación (se ve en la UI directamente).

**Tiempo**: 1–2 días (incluye testing en distintos navegadores/iOS Safari quirks).

---

#### Fase 8 — Página Following mejorada

**Objetivo**: que la pantalla "Siguiendo" muestre claramente de quién estoy recibiendo viaje, con su estado de conexión y la opción de dejar de seguir.

**Archivos a tocar**:
- `src/pages/Following.tsx` — refactor.
- `src/state/tripShare.ts` — exponer estado de conexión por peer entrante.

**Cambios**:

1. Cabecera por amigo entrante: alias + chip de estado (`connected` / `reconnecting` / `last seen 5 min ago`).
2. Mapa principal: solo el amigo seleccionado (igual que ahora).
3. Lista de viajes terminados con botón "Quitar de la lista".
4. Si el amigo está offline y tengo su `incomingTripShare` activo, mostrar "Esperando reconexión…" con timestamp del último location recibido.
5. Empty state mejorado: distinguir entre "nadie ha compartido nunca" y "todos están offline".

**Tiempo**: 1 día.

---

#### Fase 9 — Tests e2e + cobertura

**Tests a añadir**:

| Test | Cubre |
|---|---|
| `tests/multiPeer.test.ts` | Fase 1: map de peers, status, sendTo, subscribeToDevice |
| `tests/tripShareDelivery.test.ts` | Fases 3–4: ack, timeout, retry, estados |
| `tests/inviteLink.test.ts` | Fase 6: encode/decode, validación de versión, expiración |
| `tests/connectRoute.test.ts` | Fase 6: parseo de `/connect?o=...`, flujo del joiner |
| `tests/incomingPersistence.test.ts` | Fase 2: incomingTripShares se persiste, sobrevive a reload |

**E2E manual** (checklist en `docs/manual-test-plan.md`):

1. Emparejar A–B (manual SDP).
2. Emparejar A–C (manual SDP).
3. Iniciar viaje en A, compartir.
4. B recibe push + aparece en `/following`.
5. Cerrar B, esperar 2 min, abrir B → ¿aparece como `reconnecting`?
6. Reabrir B → A debería reenviar `start` automáticamente → B recibe ack.
7. Cerrar C, en A pulsar "📤 invitar" → WhatsApp → enviar a C → C abre enlace → conecta → recibe.
8. Liempiar `incomingTripShares` de más de 7 días.

**Tiempo**: 1–2 días.

---

#### Fase 10 — Documentación y release

**Cambios**:

1. `README.md` — actualizar sección "Características" + "Pairing WebRTC" + añadir "Compartir viaje con amigos".
2. `ROADMAP.md` — marcar Hito 7 como completado, mover a "Hitos completados".
3. `docs/connect-deeplink.md` — output de Fase 0.
4. `docs/manual-test-plan.md` — output de Fase 9.
5. Screenshots / GIF corto en el README mostrando el flujo de invitar por WhatsApp.
6. CHANGELOG entry.

**Tiempo**: 0.5–1 día.

---

### Resumen de esfuerzo

| Fase | Descripción | Tiempo |
|---|---|---|
| 0 | Decisiones de diseño | 0.5–1 d |
| 1 | Multi-peer en sync store | 2–3 d |
| 2 | Schema IndexedDB | 1 d |
| 3 | Protocolo `trip-share-ack` | 0.5 d |
| 4 | `useTripShareBridge` multi-fanout | 2 d |
| 5 | UI Trip: panel destinatarios | 1 d |
| 6 | Fallback externo (deeplink + invite) | 2–3 d |
| 7 | Notificaciones push | 1–2 d |
| 8 | Following mejorada | 1 d |
| 9 | Tests | 1–2 d |
| 10 | Docs + release | 0.5–1 d |
| **Total** | | **12–17 días** |

### Dependencias entre fases

```
Fase 0 ──► Fase 6 (decisión Opción A vs B)
  │
  ▼
Fase 1 ──► Fase 3 ──► Fase 4 ──► Fase 5
  │            │          │
  │            ▼          ▼
  │          Fase 8   Fase 2
  │                       │
  └────────► Fase 6 ◄─────┘
                │
                ▼
              Fase 7
                │
                ▼
              Fase 9
                │
                ▼
              Fase 10
```

Las fases 2, 3, 7 y 8 se pueden hacer en paralelo a las demás si hay capacidad.

### Riesgos conocidos

1. **Opción A (answer por WhatsApp) es feo UX**. Si se confirma la decisión, podemos considerar Opción B desde el principio aunque añada algo de trabajo en el server.
2. **iOS Safari tiene límites en WebRTC y Service Workers** (instalación obligatoria desde "Add to Home Screen"). Documentar en README y validar en testing.
3. **Multi-peer simultáneo consume batería**. 4 pares abiertos envían/recibén heartbeat → evaluar necesidad de `ping/pong` con throttling.
4. **Persistencia del deviceKey**: si el emisor reinstala portami, sus deviceKey cambia y todos sus amigos quedan `unreachable`. Detectar y mostrar UI "Tu identidad de dispositivo ha cambiado, re-empareja con tus amigos". No se aborda en este hito pero se deja nota.

---

## Próximos hitos de la app (post Hito 7)

### Hito 8 — Mejoras de live tracking

- ETA más preciso basado en velocidad histórica del bus (no solo la del último sample).
- Modo "vista bus" en el mapa: el bus como elemento central con la ruta detrás.
- Botón "ya llegué" en Trip que finaliza el viaje cuando estás dentro de 30 m del destino.

### Hito 9 — Mejoras de notificaciones

- Configuración de notificaciones (qué alertas quiere el usuario).
- Modo "no molestar" (horario nocturno).
- Resumen diario: "hoy cogiste 2 buses, recorriste 12 km".

### Hito 10 — App nativa opcional

- Tauri o Capacitor para iOS/Android nativo (mejor geofencing, push real, mejor soporte de WebRTC persistente).

## Cómo pruebo el conjunto

```bash
# App con server local
cd ../portami-server && deno task start    # http://localhost:8000
cd portami && VITE_API_BASE=http://localhost:8000 npm run dev

# App sin server (modo offline puro)
npm run dev    # MSW intercepta todo
```

## Cómo pruebo Hito 7 en local

1. Abre dos pestañas en `localhost:5173` con perfiles de navegador distintos (Chrome → "New incognito profile" o similar).
2. Pestaña A: Settings → "Emparejar nuevo dispositivo" → copiar offer.
3. Pestaña B: Settings → "Emparejar nuevo dispositivo" → pegar offer → copiar answer → pegar en A.
4. Validar que ambas quedan `connected` en el panel de Settings.
5. En A: iniciar un viaje → compartir → comprobar que B lo recibe en `/following`.
6. Cerrar B, esperar 30 s, abrir B → comprobar que A le reenvía `start` automáticamente.
7. Probar el flujo de invite: cerrar B → en A pulsar "📤 invitar" → "Copiar enlace" → en B abrir el enlace (pegar en la barra de direcciones con `?o=...`).
