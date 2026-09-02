# Roadmap — Liquidación de deuda técnica

> Documento vivo. El Hito 8 se cerró con la auditoría inicial
> (ver `ROADMAP.md` histórico) y las correcciones resultantes.
> Este archivo enumera lo que **queda** para alcanzar paridad con
> un proyecto profesional mantenido en producción.

## ⚠️ Regla de oro de privacidad — NO ROMPER (noviembre 2026)

**El servidor SOLO contiene GPS de los usuarios que tienen activado
el "modo colaborador" (opt-in explícito en Settings). El GPS
compartido entre amigos va SIEMPRE por WebRTC P2P, NUNCA por el
servidor.**

| Quién activa GPS | Hacia dónde va | Cómo |
|---|---|---|
| Cualquier viaje (watcher) | **Disco local** (IndexedDB) | `useTripStore.setLastSample` — solo el propio usuario lo ve |
| "Compartir con amigos emparejados" (toggle off por defecto) | Directo al dispositivo del amigo | `useTripShareBridge` → WebRTC DataChannel (`sync.sendTo`) |
| "Modo colaborador" (toggle off por defecto) | **Servidor** (para que "el resto" vea por dónde va el bus) | `geo/watcher.pushSample` → `POST /api/trips/:id/samples` |

Reglas:

1. **Default**: el GPS no sale del dispositivo. El viaje se
   persiste en el propio IDB del usuario. El server no ve nada.
2. **"Compartir con amigos"** = flujo P2P, no toca el server.
   El server nunca ve los mensajes `trip-share-start/location/end`.
   Esto es WebRTC DataChannel, dispositivo-a-dispositivo.
3. **"Modo colaborador"** = GPS al server para que otros
   usuarios (no amigos) puedan ver dónde está el bus. Es opt-in
   explícito. Solo se activa GPS al server si y solo si este
   toggle está ON.
4. Las dos pueden coexistir. El usuario puede tener amigos
   emparejados viendo su posición P2P Y, además, contribuir al
   server para que el resto de la comunidad vea el bus.

**Tests de regresión obligatorios** antes de cualquier cambio al
flujo de GPS:

- `tests/e2e/05-privacy-notice.spec.ts` — los strings de privacidad
  existen en los 3 bundles.
- (Pendiente) `tests/watcher.test.ts` — el watcher **no** postea a
  server si `isCollaborateEnabled()` es `false`.

Si alguien propone "sube GPS al server por defecto para que
funcione el histórico / la predicción de llegadas / lo que sea",
rechazar a menos que el usuario lo pida explícitamente y entienda
las implicaciones.

## Despliegue y rotación de URLs

Ver `SITES.md` para el registro de URLs, dónde rotar `VITE_API_BASE`
cuando el server cambia de hostname, y la convención de mantener
los dos repos sincronizados (`portami/` frontend, `../portami-server`
backend). Cualquier cambio de endpoint o wire format del server
debe reflejarse en `src/api/types.ts` + `mocks/handlers.ts` del
cliente.

## Estado actual (post-liquidación)

| Métrica | Valor |
|---|---|
| `npm run typecheck` (strict, `noUncheckedIndexedAccess`) | 0 errores |
| `npm run lint` | 0 warnings |
| `npm test` (Vitest) | 180 tests, 21 files |
| `npm run build` | OK; chunks separados por vendor |
| `npm run analyze` | OK; produce `dist/stats.html` |
| `npm run test:e2e` (Playwright) | 5 tests, 4 files (Chromium) |
| `npm audit` en CI | sí, `--audit-level=high` |

## Hitos completados

### Hito 8 — Higiene de build y cache ✅

- [x] **8.1** `tsc -b` → `tsc --noEmit` en `package.json`.
- [x] **8.2** `.gitignore` cubre `tsconfig.tsbuildinfo`.
- [x] **8.3** `cleanupOutdatedCaches()` + listener `activate` que purga
      caches viejos por nombre (`portami-tiles-v*`, `portami-api-v*`).
- [x] **8.4** `npm audit --audit-level=high` en `ci.yml`.

### Hito 9 — Performance y observabilidad del bundle ✅

- [x] **9.1** `build.rollupOptions.output.manualChunks` separa
      `react-vendor`, `leaflet`, `qrcode`, `vendor` y `app`.
- [x] **9.2** `rollup-plugin-visualizer` con `npm run analyze`.
- [x] **9.3** React.lazy() en Board, Explore, Record, Trip,
      RouteDetail, Following, Connect, ConnectBack — su propio
      chunk cada uno. Redujo `index` de 853 kB → 458 kB (gzip 168→147 kB).

### Hito 10 — Tests end-to-end (Playwright) ✅

- [x] **10.1** `playwright.config.ts`.
- [x] **10.2** `tests/e2e/01-boot.spec.ts` — boot + bottom-nav.
- [x] **10.3** `tests/e2e/02-trip-flow.spec.ts` — Board flow.
- [x] **10.4** `tests/e2e/03-identity-backup.spec.ts` — export/regen/import.
- [x] **10.5** `tests/e2e/04-i18n-language-switch.spec.ts` — auditor
      que verifica que cambiar idioma en Settings propaga a toda la
      UI (incluyendo el siguiente reload). Véase el Hito 11.
- [x] **10.6** Job opcional `e2e:` en `ci.yml` que instala Chromium.

### Hito 12 — DRY + tests de componentes extraídos ✅

**R1 — Extraer RecipientList**
- Movido de `src/pages/Trip.tsx` (embebido, sin test posible) a
  `src/components/RecipientList.tsx` (componente puro con props).
- Test `tests/recipientList.test.tsx` con 7 tests:
  renderiza null sin `outgoing`, mensaje `noRecipients` con
  lista vacía, plural correcto (1/3 friends), alias-vs-deviceId
  fallback, botones retry/invite solo en `failed`/`unreachable`,
  callback wiring, switch de locale es→en.
- i18n: los 3 strings hardcoded restantes
  (`aria-label="Reintentar"`, `title="Reintentar"`, `aria-label="Invitar por otra app"`,
  `title="Invitar por WhatsApp / Telegram / SMS"`) van ahora por
  `t('trip.share.retry' | 'retryTitle' | 'invite' | 'inviteTitle')`.
  Claves añadidas en las 3 locales.

**R3 — Hook `useInterval`**
- `src/hooks/useInterval.ts` centraliza la lógica de `setInterval`
  en `useEffect`. Maneja: callback estable (ref + latest closure),
  cleanup en unmount, `pause: true` para detener sin desuscribir,
  early-return para `delayMs <= 0`.
- Test `tests/useInterval.test.ts` (5 tests) cubre mount, unmount,
  pause, no-stale-closure, delayMs inválido.
- Aplicado en `pages/Explore.tsx`, `pages/RouteDetail.tsx` y
  `storage/useStorageJanitor.ts` — se eliminaron 3 copias del
  patrón `cancelled` + `setInterval` + `clearInterval`.

### Hito 11 — i18n end-to-end ✅ (bug de "no cambian los textos")

**Síntoma reportado por el usuario**: al cambiar de idioma, ciertos
textos no se actualizaban. La auditoría (spec 04) confirmó el
síntoma en Home, Board, Journey, Settings.

**Causa raíz**: combinación de tres bugs concurrentes:

1. **`i18next-browser-languagedetector` no respetaba
   `lookupLocalStorage: 'portami.lang'`** — algunas builds de la
   librería hacen no-op silencioso cuando se combinan
   `caches: ['localStorage']` con `lookupLocalStorage`. El
   detector escribía al default `i18nextLng` (que nunca usamos)
   y leía del nuestro al inicializar. Tras un reload, la app
   arrancaba con `fallbackLng: 'es'` aunque localStorage tuviera
   `portami.lang = 'en'`.
2. **Strings hardcoded en JSX** — `Home.tsx` (`He subido a un bus/tren`,
   `Planear un viaje`), `Settings.tsx` (`Tu ID anónimo`),
   `Board.tsx` (`Subir a un bus/tren`), `ConfirmDialog`,
   `PassphrasePrompt`, `InviteModal`, `StopAlertsCard`,
   `StopRequestSection`. Reemplazados por `t()` + claves en
   `public/locales/{es,ca,en}/common.json`.
3. **Componente `Board` no estaba marcado como `lazy()`** — quedó
   embebido en el chunk principal y rompía el patrón de Suspense.

**Resolución:**

- Sustituido `LanguageDetector` por lectura síncrona de
  `portami.lang` en el init (`lng: initialLng`). Más simple,
  robusto, y sin dependencia de un library bug-prone.
- Añadidas claves faltantes en `home.*`, `trip.share.*`,
  `recipient.*`, `vehicle.*`, `journey.*`, `following.*`,
  `board.*`, `server.*`, `passphrase.*` en las 3 locales.
- `BoardPage` ahora `lazy()`.
- `03-identity-backup.spec.ts` usa selectores regex bilingües
  para no asumir español ni inglés.

**Validación** — `tests/e2e/04-i18n-language-switch.spec.ts`
recorre los 3 idiomas vía reload + `<body>.innerText` y
comprueba que cada clave i18n visible resuelve al valor
esperado en cada idioma. Pasa en 1.3 s.

## Hitos fuera de alcance inmediato

| Item | Razón |
|---|---|
| Integración CI con backend real | El repo aún no tiene un cliente HTTP que apunte al server en prod; la integración se hará cuando exista el server-side estable. |
| Lazy-loading agresivo por ruta individual | El coste actual del bundle inicial (458 kB / gzip 147 kB) es aceptable para 3G+. Vale la pena solo cuando RUM muestre regresión de TTI. |
| Internacionalización de strings hardcoded restantes en `StopAlertsCard`, `StopRequestSection`, `Record.tsx`, `RouteDetail.tsx`, `Sync.tsx` | Trabajo de copy de baja prioridad. Aceptable para v0.1; cubriremos en una iteración posterior. |
| Migrar `zustand` v5 a `zustand-x` | No aporta. |
| Sustituir MSW por un dev server real | MSW es ideal para offline-first; el dev server solo añadiría complejidad. |

## Bugs reportados (post-Hito 12)

### "Server down" falso (noviembre 2026)

**Síntoma**: el cliente muestra "Servidor caído" o "Modo offline" en
el badge de salud cuando el server está vivo. Reproducible
abriendo una preview local, una PR preview de GitHub Pages, o
cualquier deploy bajo un subdominio que no esté en la allow-list
de CORS del server.

**Causa raíz (server-side)**: en `portami-server/main.ts:70-76`,
el middleware CORS de Hono devuelve `corsOrigins[0]` cuando el
`Origin` no está en la allow-list. El browser compara contra el
`Origin` enviado y rechaza → la app ve un CORS error → el
`catch` del poll actualiza `raw` a 'stopped' → badge "Server down".

Repro confirmado con curl:

```bash
curl -sI -H "Origin: https://random-frontend.example.com" \
  https://portami-server-6mv9bn5jhvvb.gabrielcatdev.deno.net/health
# → access-control-allow-origin: https://gabrielcatdeveloper.github.io
# (el browser rechazará esta respuesta)
```

**Fix** (bloqueado en server-side, ver
`../portami-server/ROADMAP.md → Hito 3b`): el server debe devolver
`undefined` (o el origin que el cliente envió, si está en la lista)
cuando el origin no está en la allow-list, nunca un origin
equivocado.

**Una vez fixeado el server**, este Hito en el cliente:

- Distinguir visualmente entre "poll falló (CORS/red)" y "server
  reporta caído". Mostrar un mensaje accionable al usuario
  (ej. "Reintentar ahora") en lugar de esperar al siguiente poll.
- Añadir un botón "Reintentar" en el badge de salud que fuerce
  un poll inmediato, en vez de los 30 s del `setInterval`.
- Loggear el error del `fetch` al menos a `console.warn` para
  facilitar el diagnóstico.

### "Sin batería" — última posición conocida (noviembre 2026)

**Síntoma reportado por el usuario**: si a un amigo se le queda el
teléfono sin batería durante un viaje, los demás no pueden saber
dónde buscarlo. La app no expone "última posición conocida" — solo
muestra el viaje activo, que expira en cuanto se pierde la conexión
con el emisor.

**Diseño completo**: ver `../portami-server/ROADMAP.md → Hito 4b`.
El server debe persistir y exponer `GET /api/trips/:id/last-location`
(retornando `{ lat, lng, ts, accuracy }` o 404 si no hay), accesible
solo a los paired devices del anonId emisor y con TTL de 24 h.

**Una vez fixeado el server**, este Hito en el cliente:

- En la página `/following`, debajo del mapa del viaje activo,
  mostrar la "última posición conocida" del sender con timestamp
  relativo ("hace 5 min", "hace 2 h").
- Si el server marca la posición como `stale` (>24 h sin updates),
  mostrar un chip "STALE" en lugar del punto en el mapa.
- Inferir contexto para que los amigos sepan **dónde buscar**:
  - "Última posición: parada X, hace 8 min" si el último sample
    está dentro de la polilínea de la ruta (probable espera
    legítima en una parada).
  - "Última posición: a 200 m de la parada más cercana, hace 3 min"
    si el último sample está fuera de la ruta (alerta: no se
    mueve en un punto que no es parada).
  - Necesita un nuevo endpoint server-side
    `GET /api/trips/:id/snap-to-route` o calcularlo en cliente
    contra la polilínea de la ruta.
- CTA secundario "Llamar a emergencias" (link `tel:112` configurable
  por locale).
- Cuando el sender sigue compartiendo pero la app no recibe
  acks del peer, mostrar "Esperando confirmación del amigo
  conectado…" en lugar de dar por perdida la sesión.

**Orden recomendado**: hacer primero la feature de "Rescue me"
(Hito 13) que ya está planificada, después el Hito 4b del
server, y por último la UI del cliente.

## Política de contribución

Cualquier nuevo item de deuda técnica se añade al final de este
archivo, ordenado por fase estimada. Cada item debe tener:

1. **Descripción** en una frase.
2. **Riesgo**: lo que puede romperse al tocar.
3. **Esfuerzo**: XS / S / M / L.
4. **Validación**: comandos concretos que confirman que el cambio
   no introduce regresión (p. ej. `npm run typecheck`, `npm test`,
   `npm run build`).

No se cierran items sin esos cuatro campos.

## Hitos fuera de alcance inmediato

| Item | Razón |
|---|---|
| Integración CI con backend real (`deno deploy`) | El repo aún no tiene un cliente HTTP que apunte al server en prod; la integración se hará cuando exista el server-side estable. |
| Lazy-loading agresivo por ruta | El bundle actual de 853 kB (gzipped 268 kB) es aceptable para 3G+. Vale la pena solo cuando se observe regresión de TTI en RUM. |
| Internacionalización de strings hardcodeadas en JSX | Algunas pantallas tienen strings mixtos (i18n + literales). Una pasada de i18n completa es trabajo de copy. |
| Migrar `zustand` v5 a `zustand-x` o similar | No aporta. |
| Sustituir MSW por un dev server real | MSW es ideal para offline-first; el dev server solo añadiría complejidad. |

## Política de contribución

Cualquier nuevo item de deuda técnica se añade al final de este
archivo, ordenado por fase estimada. Cada item debe tener:

1. **Descripción** en una frase.
2. **Riesgo**: lo que puede romperse al tocar.
3. **Esfuerzo**: XS / S / M / L.
4. **Validación**: comandos concretos que confirman que el cambio
   no introduce regresión (p. ej. `npm run typecheck`, `npm test`,
   `npm run build`).

No se cierran items sin esos cuatro campos.