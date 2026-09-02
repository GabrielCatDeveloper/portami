# Auditoría integral de seguridad, bugs y robustez — `portami`

**Fecha:** 2026-09-02  
**Alcance:** repositorio frontend `portami` y backend hermano `../portami-server`  
**Modo:** solo lectura; no se modificó código fuente. Este informe es el único archivo nuevo añadido.

## Executive Summary

La aplicación tiene una base razonable: TypeScript estricto, React/Vite con code splitting, IndexedDB para persistencia local, MSW para desarrollo, Hono en el backend, CORS con allow-list, Ed25519 para identidad, ECDH/AES-GCM para transferencias P2P, PBKDF2 para backups y pruebas unitarias/E2E existentes.

El problema principal es que varias garantías documentadas no están cerradas en el backend real. El backend no verifica las firmas ni los sobres enviados por el cliente, por lo que las operaciones de escritura son esencialmente públicas. Además, el cliente envía un sobre firmado, mientras los handlers del servidor esperan el body sin desenvolver; las operaciones firmadas de producción fallan o crean datos incompletos. La combinación de un endpoint de rutas sin autorización y un tooltip de Leaflet que inserta HTML sin sanitizar permite almacenar y ejecutar JavaScript en el origen de la aplicación.

**Resultado:** 44 findings: **2 CRITICAL, 14 HIGH, 22 MEDIUM, 5 LOW y 1 INFO**.

Riesgo global: **alto para producción**. No se recomienda tratar el backend como listo para recibir usuarios reales hasta corregir la autenticación, el contrato firmado, XSS y los flujos P2P.

## Metodología y evidencia

Se revisaron los dos repositorios, incluyendo configuración, scripts, build, PWA/Service Worker, API, base de datos, WebSocket, IndexedDB, WebRTC, formularios, navegación, errores, responsive/mobile, dependencias, CI y tests.

Comprobaciones ejecutadas:

- `npm run typecheck`: correcto.
- `npm run lint`: correcto.
- `npm test`: **183/183 tests** en 22 archivos.
- `npm run test:e2e`: **6/6 tests** en Chromium.
- `deno test --unstable-kv --allow-net --allow-read --allow-env --allow-write tests/`: **21/21 tests**.
- `deno check **/*.ts`: correcto.
- Build de producción en `/tmp/opencode/portami-build`: correcto; 32 entradas de precache y `sw.js` generado.
- `npm audit --audit-level=high`: **8 vulnerabilidades** transitivas: 1 critical, 1 high y 6 moderate.
- Prueba aislada del backend en memoria: confirmó statuses `201/200` para operaciones sin firma, sobres firmados que producen datos incompletos y un `POST /samples` firmado que termina en `500`.

## Architecture Overview

### Frontend

- SPA/PWA React 18 + TypeScript + Vite.
- Routing con `BrowserRouter`; el path se configura con `VITE_BASE_PATH`.
- Estado con Zustand para identidad, viajes, colaboración, alertas, pruebas, salud y sincronización.
- Persistencia principal en IndexedDB mediante `idb`.
- API REST firmada en `src/api/client.ts`.
- MSW para mocks; los mocks no implementan el contrato de seguridad del backend.
- Mapas Leaflet/OpenStreetMap.
- P2P con WebRTC/DataChannel, pairing mediante SDP/código y `sharedTrip` mediante IndexedDB.

### Backend

- Repositorio hermano `../portami-server`, Hono sobre Deno.
- Persistencia Deno KV con fallback a `MemoryStore`.
- Estado de salud, carga manual, WebSocket, planificación de journeys y relay de muestras.
- El backend no tiene middleware de autenticación/autorización, rate limiting, validación de esquemas ni transacciones de negocio.

### Flujo de datos observado

```text
Usuario/UI
  -> API client (sobre firmado)
  -> CORS + Hono
  -> store (KV o MemoryStore)
  -> respuesta
```

En la práctica, el backend no verifica el sobre ni aplica propiedad, por lo que el flujo anterior no constituye un límite de seguridad.

## Critical Findings

### FE-001 — Stored DOM XSS mediante tooltips de Leaflet

**Archivo:** `src/components/LeafletMap.tsx:139,144,200`  
**Función/componente:** `LeafletMap`, `bindTooltip`  
**Estado:** Confirmado

**Problema:**   datos procedentes del servidor se pasan directamente como strings a `bindTooltip`. Leaflet 1.9.4 asigna strings de contenido a `innerHTML` en `node_modules/leaflet/src/layer/DivOverlay.js:273-281`.

**Reproducción:**

1. Un cliente no autenticado crea una ruta con `POST /api/routes` y `name` o un `stop.name` como `<img src=x onerror="...">`.
2. La ruta se lista en `GET /api/routes` o `GET /api/routes/:id`.
3. La víctima abre Home/Explore/RouteDetail/Trip; Leaflet llama a `line.bindTooltip(r.name)` o a `bindTooltip` con nombres de paradas.
4. También puede crearse un viaje con un `pub` que contenga markup; `GET /api/active-buses` lo devuelve en `anonId` y `LeafletMap.tsx:200` lo inserta en otro tooltip.

**Impacto:**   ejecución de JavaScript en el origen de la PWA. El atacante puede leer la clave privada Ed25519/Dispositivo desde IndexedDB, firmar peticiones, leer estado local, realizar acciones como usuario o exfiltrar datos. No existe CSP que reduzca sustancialmente el impacto.

**Causa:**   confianza en el escapado de React y ausencia de sanitización explícita antes de una API de Leaflet que trata strings como HTML.

**Solución:** no pasar HTML a `bindTooltip`; usar nodos/texto escapado o sanitizar con una política allow-list. Validar y escapar también todos los nombres de paradas, alias y `anonId`. Aplicar CSP como defensa adicional.

**Tests recomendados:** crear una ruta con payloads HTML, abrir todas las vistas de mapa, verificar que no exista `onerror`/`img` inyectado y probar el caso de `anonId` malicious.

### API-001 — El protocolo firmado no es compatible con el backend

**Archivos:** `src/api/client.ts:65-87`; `../portami-server/main.ts:148-155,164-198,201-223,332-370`  
**Función/componente:** `apiFetch` y todos los handlers de escritura  
**Estado:** Confirmado

**Problema:**   el cliente envía un `SignedEnvelope` con campos `pub`, `nonce`, `ts`, `body` y `sig`; el backend no lo desenvuelve ni verifica firma. Además, varios handlers leen `body.routeId`, `body.ts`, `body.kind` o `body.plate` directamente, pero reciben el sobre completo.

**Reproducción:** con la aplicación backend iniciada en `PORTAMI_STORE=memory`:

1. `POST /api/routes` con `{pub, nonce, ts, body, sig}` produce un sobre en la respuesta y un objeto sin `createdBy`; el servidor también fuerza `version=1`.
2. `POST /api/trips/start` con sobre firmado devuelve `200` pero crea un viaje cuyo `routeId` no es el solicitado porque lee `body.ts`/`body.pub` en el sobre.
3. `POST /api/trips/t-x/samples` con sobre firmado llega a `body.samples` como `undefined` y termina en `500`.

**Impacto:**   las operaciones principales firmadas no funcionan en producción y el sistema no tiene autenticación. Crear rutas, iniciar viajes, enviar muestras, votar, resolver incidencias y actualizar información colaborativa son posibles sin identidad válida.

**Causa:**   el contrato se documenta y prueba en el cliente/mocks, pero el backend no aplica ese contrato. Los tests del servidor usan bodies directos y no pruebas de integración con `SignedEnvelope`.

**Solución:** definir un único contrato: el backend debe validar y extraer el sobre, verificar timestamp/nonce/firma con Web Crypto/Ed25519 y repetir el cuerpo canónico. Añadir tests de contrato contra el backend real y mantener paridad con MSW.

**Tests recomendados:** matriz completa de peticiones con firma válida, firma alterada, nonce repetido, timestamp caducado, body manipulado, identidad incorrecta y body directo rechazado.

## High Findings

### FE-014 — Base path de Vite incorrecto rompe invitaciones y navegación P2P

**Archivos:** `src/sync/invite.ts:107,162`; `src/App.tsx:64-78`; `src/components/InviteModal.tsx:60-66`  
**Función/componente:** `createInviteLink`, `InviteModal`, handler `NAVIGATE`  
**Estado:** Confirmado

**Problema:** el runtime usa `import.meta.env.BASE_PATH`, pero Vite expone `import.meta.env.BASE_URL`/`BASE_URL` y no `BASE_PATH`. `createInviteLink` usa `${window.location.origin}${import.meta.env.BASE_PATH}`; `App` construye `new URL(import.meta.env.BASE_PATH, ...)`.

**Reproducción:** abrir `InviteModal` sin pasar `baseUrl` y ejecutar una build. La build temporal inspeccionada contiene `window.location.origin}undefined}connect?` y `window.location.origin}undefined}connect-back?`. Pulsar el mensaje de notificación produce un `TypeError`, que el `catch` de `App` descarta.

**Impacto:** el flujo anunciado de invitación P2P y la navegación desde notificaciones no funcionan; los usuarios no pueden recuperar/reconectar a pares mediante los enlaces previstos.

**Causa:** se usa una variable de configuración inexistente en vez de `import.meta.env.BASE_URL`, una función de URL compartida o `document.baseURI`.

**Solución:** resolver el path con `import.meta.env.BASE_URL`/`document.baseURI`, validar la salida y probar explícitamente root, `/portami/` y PWA instalada.

**Tests recomendados:** comprobar enlaces `connect`/`connect-back` sin `baseUrl`, build de producción, service worker y navegación de notificación en ambos subpaths.

### API-002 — Suscripciones WebSocket sin autenticación ni autorización

**Archivos:** `../portami-server/main.ts:404-410`; `../portami-server/ws.ts:48-69`  
**Función/componente:** `/ws`, `handleConnection`  
**Estado:** Confirmado

**Problema:**   cualquier cliente puede abrir un WebSocket y enviar `{"kind":"subscribe","tripId":"..."}`. El servidor no valida identidad, propietario, pertenencia a una lista de dispositivos compartidos ni la existencia/estado del viaje. El mensaje `hello` ni siquiera se procesa.

**Reproducción:**

1. Obtener un `tripId` de `GET /api/active-buses`.
2. Conectar a `/ws` y enviar `subscribe` con ese ID.
3. Publicar una muestra en el viaje; el cliente no autorizado recibe `sample` y `trip-ended`.

**Impacto:**   exposición de coordenadas GPS y del ciclo de vida de viajes a cualquier persona que conozca o adivine un ID. Los IDs de viaje se generan con solo ocho caracteres hexadecimales (`randomUUID().slice(0,8)`), lo que facilita enumeración.

**Causa:**   el endpoint WebSocket se añadió sin autenticación, rate limiting, límites de suscripciones ni control de propiedad.

**Solución:** handshake firmado, autorización por viaje/participante, validación de `tripId`, límites de suscripciones y rate limiting por conexión. No transmitir streams a clientes anónimos.

**Tests recomendados:** probar suscripción ajena, conexión no autenticada, ID inexistente, enumeración, demasiadas suscripciones y ACK válido.

### API-003 — Endpoints administrativos públicos

**Archivo:** `../portami-server/main.ts:102-113,404`  
**Función/componente:** `POST /admin/status/:s`, `POST /admin/restart-marker`  
**Estado:** Confirmado

**Problema:**   los endpoints administrativos no tienen autenticación ni red limitada a localhost, pero el servidor escucha en `0.0.0.0` y se despliega públicamente.

**Reproducción:** enviar `POST /admin/status/stopped` o `POST /admin/restart-marker` sin headers ni token.

**Impacto:**   cualquier atacante puede forzar estado `stopped`, hacer que la UI muestre el servidor como degradado, reiniciar el marcador de warm-up y afectar la disponibilidad/operación de todas las instancias que compartan el endpoint.

**Causa:**   el comentario “keep it bound to localhost” no se convierte en una restricción de red.

**Solución:** eliminar `/admin` de la superficie pública o protegerlo con una variable de entorno/token de administración, comprobar origen/red, rate limiting y auditoría. No devolver una API administrativa desde el mismo servidor público.

**Tests recomendados:** verificar `401/403`, rechazo entre origen, rate limit, cambio de estado no autorizado y auditoría de llamadas válidas.

### API-004 — Mass assignment y overwrite de rutas

**Archivo:** `../portami-server/main.ts:148-155`; `../portami-server/db.ts:58-60`  
**Función/componente:** `POST /api/routes`  
**Estado:** Confirmado

**Problema:**   el cliente puede enviar `id`, `createdBy`, `version`, `createdAt`, `active` y el servidor acepta/establece campos controlados. `putRoute` sobrescribe la clave `route.id` sin comprobar propietario, versión ni conflicto. La prueba aislada confirmó que un `id` de seed (`r-madrid-5`) puede ser sobrescrito sin firma.

**Reproducción:** enviar `POST /api/routes` con `id: "r-madrid-5"`, `createdBy: "attacker"`, `version: 99` y contenido arbitrario.

**Impacto:**   modificación no autorizada de rutas públicas, atribución falsa a otro usuario, pérdida de historial/versiones y posible XSS mediante nombres maliciosos (véase FE-001).

**Causa:**   el backend no aplica allow-list de campos ni control de bloqueo optimista ni propiedad.

**Solución:** derivar `id` y `createdBy` del sobre verificado, ignorar campos de sistema, validar esquema y usar versionado/atomic check al editar.

**Tests recomendados:** verificar campos prohibidos, overwrite de seed, ID generado, versión simultánea y propiedad.

### API-005 — IDOR y éxito falso en viajes

**Archivo:** `../portami-server/main.ts:201-237`  
**Función/componente:** `start`, `samples`, `end`, `get trip`  
**Estado:** Confirmado

**Problema:**   ninguna operación de viaje verifica que `envelope.pub` sea el propietario. `POST /trips/:id/samples` no comprueba el resultado de `updateTrip`; si el viaje no existe devuelve igualmente `204`. `POST /end` hace broadcast y devuelve `204` aunque `updateTrip` haya devuelto `null`.

**Reproducción:** un atacante conoce un `tripId`, envía muestras o finaliza el viaje sin haberlo creado y recibe `204`.

**Impacto:**   cualquier usuario puede contaminar la última muestra o finalizar viajes ajenos. El cliente cree que la operación se completó cuando el viaje no existía o no fue modificado.

**Causa:**   ausencia de propiedad y de comprobación del resultado de persistencia.

**Solución:** autorización por propietario/colaborador, `404/403` explícitos, validación de `samples`, timestamps/rangos y sólo emitir broadcast tras una mutación confirmada.

**Tests recomendados:** propietario, colaborador, tercero, ID inexistente, muestras vacías, viaje ya finalizado y carrera entre end/sample.

### API-006 — Votos de propuestas sin identidad ni deduplicación

**Archivo:** `../portami-server/main.ts:164-198`; `../portami-server/types.ts:104-110`; `../portami-server/db.ts:105-113`  
**Función/componente:** `POST /api/proposals/:id/votes`  
**Estado:** Confirmado

**Problema:**   el servidor no registra `voter`, no exige identidad, no deduplica y ni siquiera valida `kind`; cualquier cuerpo que no sea exactamente `approve` incrementa `rejections`. `ProposalVote` existe como tipo, pero no se persiste ni se consulta.

**Reproducción:** enviar repetidamente votos sin firma; un mismo `kind` o un `kind` ausente modifica los contadores hasta aprobar/rechazar una propuesta.

**Impacto:**   aprobación o rechazo manipulado, spam de votos y pérdida de integridad democrática.

**Causa:**   el endpoint acepta un contador anónimo y mutable como si fuera un voto registrado.

**Solución:** verificar identidad, almacenar votos por propuesta/votante, aceptar únicamente enum válido, hacer incremento atómico y expirar propuestas antes de votar.

**Tests recomendados:** votos duplicados, dos usuarios, votos concurrentes, propuesta inexistente, firma inválida y expirada.

### P2P-001 — El routing de `trip-share` usa identificadores incompatibles

**Archivos:** `src/state/identity.ts:130-160`; `src/sync/index.ts:160-178,252-260,327-334,356-397,468-483`; `src/sync/tripShare.ts:95-105,341-383,468-483`  
**Función/componente:** `bootstrapPeer`, `sendTo`, `useTripShareBridge`  
**Estado:** Confirmado

**Problema:**   el diseño utiliza tres identificadores distintos:

- `deviceKey.deviceId` es un UUID aleatorio.
- `deviceKey.pubKey` es la clave pública estable.
- `pairedDevices.deviceId` se guarda finalmente como `pubKey`.

`bootstrapPeer` inserta la entrada con `pending-${Date.now()}` y no la renombra tras `hello`; `sendTo(pubKey)` no encuentra la entrada. Además, el ACK devuelve `deviceKey.deviceId` (UUID), pero `onAckReceived` busca recipients por la clave pública, por lo que tampoco puede resolver el recipient.

**Reproducción:** emparejar dos dispositivos, iniciar `trip-share`, observar que los recipients quedan `unreachable` y que los mensajes/ACK no actualizan a `delivered`.

**Impacto:**   la funcionalidad multi-peer principal no entrega mensajes de inicio, ubicación ni fin en el flujo normal. Los botones de retry/invite no pueden corregir la causa raíz.

**Causa:**   no se unificó el contrato de identidad entre `deviceId`, `pubKey` y la clave del mapa IndexedDB/Zustand.

**Solución:** usar siempre la clave pública como identificador estable, renombrar/reemplazar entradas del mapa al recibir `hello`, validar `hello.pubKey` contra el canal/identidad esperada y enviar el mismo ID en los ACKs.

**Tests recomendados:** pairing con dos peers, envío start/location/end, ACK de cada recipient, reconexión y carga de pairedDevices tras reload.

### FE-002 — El singleton `GeoWatcher` mezcla el ciclo de vida de varias pantallas

**Archivos:** `src/geo/watcher.ts:172-199,206-251`; `src/pages/Explore.tsx:43-60`; `src/pages/Record.tsx:77-90`; `src/pages/Trip.tsx:54-91`  
**Función/componente:** `GeoWatcher.start/stop/attachTrip`  
**Estado:** Confirmado

**Problema:**   un único watcher mantiene `watchId` y `currentTripId` globales. `Explore` lo inicia y lo detiene aunque ya exista un viaje activo; al volver a Trip, el watcher puede continuar sin actualizar el ID. `Record` tampoco hace `attachTrip`/`detachTrip` y `stopRecording` llama al `stop` global, pudiendo detener el watcher del viaje. Si se graba durante un viaje, `currentTripId` puede seguir apuntando al viaje anterior y las muestras se envían a otro trip.

**Reproducción:** iniciar viaje, navegar a Explore y salir; observar que el seguimiento se detiene. Después iniciar Record durante el viaje y comprobar que el `currentTripId` no corresponde al viaje nuevo.

**Impacto:**   pérdida de telemetría, muestras asignadas a otro viaje y estados de privacidad incorrectos.

**Causa:**   propiedad de la fuente GPS no está asociado a la pantalla/feature que lo solicita.

**Solución:** aislar la fuente y propiedad por feature, exponer adquisición/liberación de watchers y impedir que una feature detenga una fuente propiedad de otra.

**Tests recomendados:** transiciones Trip→Explore→Trip, Trip→Record→Trip, montaje/desmontaje, doble montaje StrictMode y cambio de permiso.

### FE-003 — `endTrip` comunica éxito local aunque el servidor conserve el viaje activo

**Archivos:** `src/state/trip.ts:48-65`; `../portami-server/main.ts:233-237`; `../portami-server/main.ts:257-270`  
**Función/componente:** `useTripStore.endTrip`  
**Estado:** Confirmado

**Problema:**   cualquier error de `POST /trips/:id/end` se captura y se convierte en éxito local. El estado pasa a `ended`, pero el servidor conserva `endedAt` sin definir; el trip sigue apareciendo en `GET /api/active-buses`.

**Reproducción:** cerrar el backend o hacer que `/end` responda 500, finalizar un viaje en la UI y consultar `/api/active-buses`.

**Impacto:**   la UI afirma que el viaje terminó mientras se sigue publicando/mostrando la última ubicación del usuario. No existe retry ni señal clara de fallo.

**Causa:**   no se distingue “pendiente de confirmación” de “finalizado” y el backend no ofrece idempotencia/reintento seguro.

**Solución:** estados `ending/error`, cola de operación, reintento con idempotency key y reconciliación del estado local con el servidor.

**Tests recomendados:** 500, timeout, desconexión, retry, end idempotente y respuesta tardía.

### AUTH-001 — Claves privadas almacenadas sin cifrar en IndexedDB

**Archivos:** `src/crypto/index.ts:106-112`; `src/storage/db.ts:18-29`; `src/state/identity.ts:43-56,120-160`  
**Función/componente:** `identity` y `deviceKey`  
**Estado:** Confirmado

**Problema:**   el JWK de la clave privada Ed25519 y el JWK de la clave ECDH se guardan directamente en IndexedDB. No hay cifrado de aplicación ni protección adicional en reposo. La clave Ed25519 firma peticiones; la clave ECDH protege transferencias P2P.

**Impacto:**   cualquier script ejecutado en el origen, extensión con acceso, XSS o compromiso del perfil del navegador puede exfiltrar claves y suplantar al dispositivo. Esto amplifica FE-001.

**Causa:**   IndexedDB se usa como almacén de secretos sin definir una frontera de seguridad para el material criptográfico.

**Solución:** cifrar el JWK con una clave no exportable/derivada del dispositivo, mover firmas sensibles a un backend/keystore nativo cuando esté disponible y reducir el tiempo de vida del material en memoria. Añadir CSP ydefensa contra XSS.

**Tests recomendados:** comprobar que un volcado de IndexedDB no contiene JWK en claro, prueba de XSS simulada y política de rotación/borrado.

### DB-001 — El fallback a `MemoryStore` puede perder toda la persistencia

**Archivo:** `../portami-server/db.ts:277-307`  
**Función/componente:** `initStore`  
**Estado:** POTENTIAL si KV no está adjunto en producción

**Problema:**   cualquier error de Deno KV provoca fallback a `MemoryStore`; incluso `PORTAMI_STORE=kv` termina usando memoria si KV falla. Los datos sólo viven en el proceso y desaparecen al reiniciar o al hacer deploy.

**Reproducción:** iniciar el backend sin KV adjunto y consultar rutas/trips; los datos se guardan en RAM y se pierden al reiniciar.

**Impacto:**   pérdida de datos de producción y comportamiento aparentemente exitoso de una API que no es persistente.

**Causa:**   el fallback se activa silenciosamente en lugar de fallar el arranque o marcar el despliegue como no persistente.

**Solución:** hacer explícita la política: fallar si se requiere persistencia, exponer un readiness flag, no servir tráfico con memoria accidental y probar la configuración de Deno Deploy.

**Tests recomendados:** KV operativo, KV no adjunto, `PORTAMI_STORE=kv`, reinicio de proceso y métricas de readiness.

### API-007 — No existe rate limiting ni límites de coste

**Archivos:** `../portami-server/main.ts:55-82`; ausencia de middleware Hono de rate limit  
**Función/componente:** todos los endpoints y WebSocket  
**Estado:** Confirmado

**Problema:**   no hay rate limiting por IP/usuario, límites de body, paginación, cuota de votos/incidencias, límites de suscripciones WebSocket ni timeout de request.

**Reproducción:** automatizar POST a `/incidents`, `/proposals/:id/votes`, `/api/journey-plan` o miles de suscripciones WS.

**Impacto:**   spam, crecimiento ilimitado de KV/listas, CPU/memoria, abuso de votos y degradación del servicio. Los endpoints administrativos agravan el problema.

**Causa:**   `cors` y el contador de estado son los únicos middlewares globales.

**Solución:** rate limiting distribuido, quotas por identidad/IP, límites de payload y consultas paginadas. Aplicar límites también a WebSocket.

**Tests recomendados:** ráfaga de requests, límites por IP, Retry-After, tamaño máximo de body y recuperación tras abuso.

### DB-002 — Actualizaciones read-modify-write no atómicas

**Archivo:** `../portami-server/db.ts:61-81,105-113`  
**Función/componente:** `updateRouteStopRequest`, `updateTrip`, `updateProposal`  
**Estado:** Confirmado

**Problema:**   `KvStore` hace `get` y después `set` sin comparación de versión ni atomic check. Dos samples/votos/reacciones concurrentes pueden perder el update del otro.

**Reproducción:** enviar dos muestras o votos simultáneos para la misma clave; ambos leen el mismo valor inicial y el último `set` reemplaza el incremento del otro.

**Impacto:**   pérdida de última posición, votos no contados, confirmación de stop request incorrecta y estados imposibles.

**Causa:**   el backend no modela versión de entidad ni operación atómica.

**Solución:** Deno KV `check`, `atomic().check(...).set(...)`, incrementadores atómicos o store de voters; definir versionado para el cliente.

**Tests recomendados:** 10/100 operaciones concurrentes por clave, comprobar monotonicidad y que un update antiguo no pise uno nuevo.

### API-008 — Resolución de incidencias sin propiedad y respuesta 200 para IDs inexistentes

**Archivo:** `../portami-server/main.ts:323-327`  
**Función/componente:** `POST /api/incidents/:id/resolve`  
**Estado:** Confirmado

**Problema:**   el handler acepta `by` arbitrario, no comprueba que la incidencia exista y no verifica que el firmante sea `reportedBy` o moderador. Devuelve `{ok:true}` incluso para `nope`.

**Reproducción:** enviar `POST /api/incidents/nope/resolve` con cualquier body o firma falsa.

**Impacto:**   cualquier atacante puede ocultar advertencias activas de otros usuarios. La UI también puede mostrar “éxito” aunque no haya ocurrido ninguna mutación.

**Causa:**   autorización y comprobación de resultado no están implementadas.

**Solución:** cargar la entidad, comprobar propiedad/rol, devolver 403/404 real y sólo marcar tras persistir.

**Tests recomendados:** propietario, tercero, moderador, ID inexistente,resolución repetida y asignación masiva de `by`.

## Medium Findings

### API-009 — Validación insuficiente de entradas y errores 500 por JSON malformado

**Archivo:** `../portami-server/main.ts:121-138,148-155,164-198,214-237,289-379`  
**Función/componente:** todos los bodies/query params  
**Estado:** Confirmado

**Problema:**   los bodies se convierten con casts TypeScript en runtime, sin esquema. Se aceptan coordenadas no finitas, tipos arbitrarios, límites negativos/NaN, IDs huérfanos y strings de longitud ilimitada. `GET /routes/nearby?lat=Infinity&lng=2` devuelve `200`; un JSON como `{"body":"{"}` produce `500 SyntaxError` en vez de `400`.

**Reproducción:** enviar body vacío, `kind` inválido, `plate` muy larga, `lat=Infinity`, `maxBoardings=99999` o `altPolyline` con miles de puntos.

**Impacto:**   respuestas incorrectas, 500 en errores de cliente, consumo de CPU/memoria y datos corruptos en persistencia.

**Causa:**   no existe validación en runtime ni middleware de error para `c.req.json()`.

**Solución:** validadores runtime por endpoint, límites máximos, normalización y error handler que devuelva 400/413/422 sin stack traces.

**Tests recomendados:** tabla de payloads válidos/inválidos, límites yafirmaciones de códigos 4xx.

### API-011 — El contrato de `/routes/nearby` difiere entre MSW y backend

**Archivos:** `mocks/handlers.ts:23-35`; `../portami-server/main.ts:121-138`  
**Función/componente:** `GET /api/routes/nearby`  
**Estado:** Confirmado

**Problema:** MSW calcula distancia real a cada segmento de la polilínea y aplica el radio de 5 km. El backend calcula una caja alrededor de la polilínea y filtra por la distancia al centro de esa caja.

**Reproducción:** situar el punto cerca de un extremo de una ruta larga y comparar `GET /api/routes/nearby` en MSW frente al servidor; el backend puede omitir la ruta que MSW devuelve.

**Impacto:** Home/Explore muestran menos rutas nearby en producción, con falsos vacíos y una experiencia distinta entre desarrollo y despliegue.

**Causa:** el mock se documenta como fuente de verdad del wire format, pero no se mantiene la misma semántica de filtrado.

**Solución:** compartir la función de cálculo/radio entre MSW y servidor, añadir tests de contrato con rutas largas y devolver una respuesta equivalente.

**Tests recomendados:** punto cerca de cada extremo, ruta de polilínea larga, radio límite y comparación MSW/backend.

### P2P-003 — Los metadatos de identidad P2P no están vinculados criptográficamente al mensaje

**Archivos:** `src/sync/peer.ts:46-57`; `src/sync/index.ts:252-260,315-340`; `src/sync/tripShare.ts:79-105,121-148`  
**Función/componente:** `Peer` DataChannel y `useTripShareBridge`  
**Estado:** POTENTIAL

**Problema:** WebRTC cifra y autentica el canal, pero cada `SyncMessage` se trata como JSON y el receptor confía en `msg.fromAnonId`, `msg.fromDeviceId` y `msg.pubKey` sin firma a nivel de aplicación ni derivación de esos campos de la clave del canal.

**Reproducción:** un par comprometido o malicioso envía un mensaje con el `tripShareId` de otro viaje y un `fromDeviceId`/`fromAnonId` diferente; el store lo persiste y usa esos campos para localizar/enviar ACKs.

**Impacto:** suplantación de identidad entre pares, contaminación de viajes recibidos o ACK falso de entrega.

**Causa:** la autenticación de transporte no liga el contenido con la identidad de aplicación que el propio protocolo afirma usar.

**Solución:** firmar el cuerpo del mensaje con la clave del dispositivo/Ed25519, incluir versión, nonce y timestamp, y verificar antes de persistir o responder.

**Tests recomendados:** mensaje con campos de identidad manipulados, replay, par desconocido, clave de canal incorrecta y ACK falso.

### AUTH-003 — Inicialización concurrente de claves puede generar material inconsistente

**Archivos:** `src/state/identity.ts:43-63,130-160`  
**Función/componente:** `init` y `ensure` de `useIdentityStore`/`useDeviceKeyStore`  
**Estado:** Confirmado

**Problema:** no hay una promesa compartida de inicialización. Dos llamadas simultáneas a `init()`/`ensure()` pueden observar que no existe material, generar dos claves y escribir ambas en IDB; la última escritura gana y la primera puede quedar huérfana.

**Reproducción:** montar la app bajo React StrictMode o invocar `ensure()`/`useDeviceKeyStore.ensure()` concurrentemente y observar varios `generate*KeyPair` y escrituras.

**Impacto:** identidad/dispositivo intermitentes, peers que ven una clave distinta a la almacenada y riesgo de pérdida de emparejamientos.

**Causa:** Zustand actualiza el estado, pero la inicialización no tiene lock ni coalescing.

**Solución:** promesa de inicialización a nivel de módulo, mutex asíncrono y reconciliación explícita de la identidad elegida.

**Tests recomendados:** dos/20 llamadas concurrentes, StrictMode, refresh, fallo de IDB y regeneración.


### FE-004 — La cola offline de GPS no existe y colisiona por `tripId`

**Archivos:** `src/storage/db.ts:91-96,193-197`; `src/geo/watcher.ts:254-265`  
**Función/componente:** `pendingSamples`, `pushSample`  
**Estado:** Confirmado

**Problema:** el store se anuncia como “offline queue”, pero `pushSample` sólo muestra un warning y descarta. Ningún escritor usa `pendingSamples`. Aunque se escribiera, el `keyPath` es sólo `tripId`, por lo que varias muestras del mismo viaje se sobrescribirían.

**Reproducción:** desconectar el servidor, permitir varias muestras y recargar la app; no se reenvían.

**Impacto:** pérdida de trayectoria GPS y contradicción con el mensaje de privacidad/offline-first.

**Causa:** el diseño de persistencia quedó declarado pero no implementado;el comentario de watcher dice “if we add a local queue”.

**Solución:** transacción para encolar `tripId + ts`, drainer al recuperar conexión, límites y política de retención.

**Tests recomendados:** 3 muestras offline, recuperar la conexión, reintento de envío, corte durante drain y límite de cola.

### FE-005 — `Record` pierde el listener al desmontar o reemplazar la pantalla

**Archivo:** `src/pages/Record.tsx:45-50,77-83`  
**Función/componente:** `startRecording`  
**Estado:** Confirmado

**Problema:**   el listener se guarda en un ref, pero no se ejecuta cleanup en el `useEffect` de montaje. Si se navega fuera, se cierra la página o se cambia de ruta, el callback sigue en `geoWatcher.listeners`.

**Reproducción:** comenzar una grabación, pulsar Atrás o cambiar de tab, esperar otra muestra y observar actualización de estado sobre un componente desmontado/advertencia de React.

**Impacto:**   fuga de memoria, callbacks retenidos y uso de CPU en segundo plano; además puede provocar errores de estado obsoleto.

**Causa:**   cleanup de la suscripción no está ligado al ciclo de vida de React.

**Solución:** cleanup en `useEffect` y cancelar siempre el `watchId`/listener al desmontar o finalizar.

**Tests recomendados:** montar/desmontar, cambiar de ruta, descartar y grabación duplicada.

### API-010 — `apiFetch` reintenta errores no transitorios y no aplica timeout/idempotencia

**Archivo:** `src/api/client.ts:97-131`  
**Función/componente:** `apiFetch`  
**Estado:** Confirmado

**Problema:**   cualquier `!res.ok` se convierte en `Error` y se reintenta, incluidos 400, 401, 403, 409 y 429. No se usa `Retry-After`, no hay `AbortController`/timeout y no existe idempotency key para POST.

**Reproducción:** hacer que un POST válido de incidencia/voto responda primero 500 y después correctamente; la operación puede repetirse. Una respuesta 429 se reintenta con backoff fijo.

**Impacto:**   mutaciones duplicadas, operaciones ambiguas, UI atascada y gasto innecesario de batería/red.

**Causa:**   el loop trata igual errores de red y errores semánticos del servidor.

**Solución:** timeout, backoff específico por status, `Retry-After`, retry sólo para operaciones idempotentes y claves de idempotencia.

**Tests recomendados:** fake timers, 400/401/409/429/500, timeout, repetir POST yrecuperar la conexión.

### FE-006 — Todos los errores de publicación se reportan como “offline”

**Archivo:** `src/pages/Record.tsx:163-205`  
**Función/componente:** `save`  
**Estado:** Confirmado

**Problema:**   después de persistir el recording local, cualquier excepción de API se convierte en `offline` y se navega a `/`. Los errores 400/401/500 se muestran como si fueran sólo falta de red.

**Reproducción:** API 500 al publicar una ruta grabada; la UI navega a Home y no se ofrece una acción para reanudar/reintentar la publicación del recording local.

**Impacto:**   pérdida de contexto operativo y publicaciones que el usuario cree erróneamente que se sincronizarán después.

**Causa:**   no se separa `ServerOfflineError` de errores de validación/autorización/servidor.

**Solución:** clasificar errores, mostrar mensaje persistente, conservar recording y ofrecer retry/cola local.

**Tests:** 400,401,500,pérdida de red,local persistence success/failure.

### FE-007 — `RouteDetail` queda en skeleton infinito tras un error de carga

**Archivo:** `src/pages/RouteDetail.tsx:117-130,217-225`  
**Función/componente:** carga inicial de ruta/propuestas  
**Estado:** Confirmado

**Problema:**   el `catch` no establece error y `finally` sólo cambia `loading`. Si la ruta no existe o la red falla, `route` permanece null y la rama `loading || !route` no tiene timeout ni botón de recuperación.

**Reproducción:** abrir `/routes/does-not-exist` con API caída o con 404.

**Impacto:**   el usuario ve un skeleton perpetuo y no puede distinguir 404, timeout o error de red.

**Causa:**   estado de error inexistente para la carga inicial.

**Solución:** estados `loading/error/empty`, AbortController y botón retry/navegación.

**Tests:** 404,500,fetch rejection,desmontaje y cambio rápido de ID.

### FE-008 — El botón de resolver compara clave pública con `anonId`

**Archivo:** `src/pages/RouteDetail.tsx:110-112,331-337`  
**Función/componente:** autorización visual de incidencia  
**Estado:** Confirmado

**Problema:**   `myPubKey` es la clave pública Ed25519, mientras `reportedBy` se construye con `anonId` (hash público con formato `XXXX-YYYY`). La condición `myPubKey === i.reportedBy` nunca se cumple.

**Reproducción:** reportar una incidencia con el usuario actual y abrir el detalle; el botón “Resolver” no aparece.

**Impacto:**   el flujo de resolución no es utilizable desde la UI, aunque el backend tampoco lo autoriza correctamente.

**Causa:**   se comparan identificadores de dominios diferentes.

**Solución:** comparar el identificador diseñado por el contrato (`reportedBy`) o incluir `pubKey` en el objeto de incidencia; unificar el tipo/nomenclatura.

**Tests:** verificar que sólo el autor o moderador ve el botón y que el backend acepta sólo esa identidad.

### FE-009 — `plannedRoute` no se transmite al bridge P2P

**Archivos:** `src/state/trip.ts:13-16,31-45`; `src/sync/tripShare.ts:51-62,240-271`; `src/pages/Trip.tsx:112-122`  
**Función/componente:** compartir viaje planificado  
**Estado:** Confirmado

**Problema:**   `startTrip` guarda `plannedRoute` en Zustand, pero `TripPage` no lo pasa a `useTripShareBridge`. El comentario de Trip afirma que se lee automáticamente, pero la llamada omite `plannedRoute`.

**Reproducción:** iniciar un viaje desde Journey, compartirlo y observar que el receptor no recibe la planificación aunque `startSharing` la conserva en el sender.

**Impacto:**   se pierde información de planificación y el receptor no puede mostrar el recorrido previsto.

**Causa:**   el estado existe, pero el componente no lo propaga al hook.

**Solución:** pasar `plannedRoute` desde `useTripStore` o hacer que el bridge lo lea directamente con selector.

**Tests:** Journey→Trip→share→Following yafirmaciones plannedRoute del receptor.

### FE-010 — Journey inicia un viaje con una ruta sintética vacía

**Archivo:** `src/pages/Journey.tsx:273-289`  
**Función/componente:** `JourneyCard.handleStart`  
**Estado:** Confirmado

**Problema:**   se crea un `Route` con `polyline: []` y paradas construidas con IDs de pasos y coordenadas `0,0`; no se consulta la ruta real devuelta por el planificador.

**Reproducción:** abrir Journey, calcular una ruta y pulsar el botón de iniciar viaje.

**Impacto:**   Trip/Map no muestra la geometría real ni paradas correctas; la colaboración y detección de paradas operates sobre datos ficticios.

**Causa:**   se usa sólo el primer viaje para construir un objeto incompleto en vez de recuperar la ruta persistida por ID.

**Solución:** enviar `routeId` real y usar la ruta cacheada/servidor; validar que tenga polyline y paradas antes de iniciar.

**Tests:** cada tipo de journey,ruta inexistente,polyline vacío,stops vacíos y navegación a Trip.

### APP-001 — Los horarios se evalúan con zonas horarias distintas

**Archivos:** `src/api/types.ts:14-24`; `src/geo/schedule.ts:19-35`; `../portami-server/journey.ts:30-41,159-164`  
**Función/componente:** `isActiveAt` / `planJourney`  
**Estado:** Confirmado

**Problema:**   el contrato de `Schedule` documenta intervalos de hora local, el frontend usa `getDay/getHours`, pero el backend usa `getUTCDay/getUTCHours` para filtrar y calcular salidas.

**Reproducción:** definir un horario local `08:00-18:00` y ejecutar el planificador desde una zona Europe/Madrid cuando el reloj UTC está fuera de la ventana.

**Impacto:**   rutas activas o salidas incorrectas en usuarios fuera de UTC, especialmente en el despliegue Deno y en Catalunya/España.

**Causa:**   no se define/store la zona horaria del schedule.

**Solución:** almacenar zona IANA o usar UTC de forma explícita y consistente; añadir tests con `TZ=Europe/Madrid` y otra zona.

**Tests:** cambio de `TZ`,medianoche entre días,horario de verano y `departAfterUtc` cercano a medianoche.

### GEO-001 — ETA no sigue el orden/distancia acumulada de la ruta

**Archivo:** `src/geo/eta.ts:29-61`  
**Función/componente:** `estimateStopEtas`  
**Estado:** Confirmado

**Problema:**   la función toma un único punto más cercano del polilínea y calcula distancia recta a cada parada; después ordena por distancia, no por orden de recorrido. No acumula distancia a lo largo de la polilínea y no tiene en cuenta el sentido del viaje.

**Reproducción:** usar una ruta curva con paradasubicadas en distintos puntos; observar que una parada lejana en la polilínea puede aparecer antes que la siguiente parada real.

**Impacto:**   ETA y orden visual engañosos para decisiones de bajada/transbordo.

**Causa:**   cálculo simplificado presentado como estimación funcional.

**Solución:** proyectar sobre un índice/segmento, acumular distancia de la proyección a cada parada, respetar sentido y documentar incertidumbre.

**Tests:** polilínea curva, mismo puntoproyección,paradas detrás/delante yorden esperado.

### PERF-001 — El polling continúa en background y puede solaparse

**Archivos:** `src/hooks/useInterval.ts:1-7,50-67`; `src/pages/Explore.tsx:63-80`; `src/pages/RouteDetail.tsx:132-154`  
**Función/componente:** `useInterval` y polling de buses/incidents  
**Estado:** Confirmado

**Problema:**   el comentario dice que el intervalo se pausa cuando `document.hidden`, pero `run()` no comprueba visibilidad. Además, el callback inmediato más los efectos/SlowMode puede lanzar requests duplicados y no existe `inFlight`.

**Reproducción:** abrir Explore en background, con red lenta, observar requests cada 15 segundos y más de una petición inicial en desarrollo.

**Impacto:**   batería, red y CPU innecesarios; respuestas tardías pueden apilarse y mostrar estados obsoletos.

**Causa:**   documentación y guardas de implementación divergentes.

**Solución:** respetar `visibilitychange`/`document.hidden`, deduplicar enFlight, coalescer respuestas y abortar timers al desmontar.

**Tests:** fake timers, hidden/visible, requests solapados, unmount yrecuperar la conexión.

### PERF-002 — Consultas sin paginación y N+1 en buses activos

**Archivos:** `../portami-server/main.ts:257-270`; `../portami-server/db.ts:148-151,257-268`  
**Función/componente:** `/api/active-buses`, `listBusReports`  
**Estado:** Confirmado

**Problema:**   `/api/active-buses` recorre todos los trips y ejecuta un `getRoute` por cada trip (`Promise.all`), aunque sólo necesita el tipo. `listBusReports` recorre todos los reports y ordena toda la lista antes de hacer `slice`. No hay paginación/cursor en listas de buses, propuestas, incidencias o reportes.

**Reproducción:** crear suficientes buses/reports y medir número de lecturas/ordenaciones;un cliente de buses recibe N consultas de ruta.

**Impacto:**   latencia y carga crecen con usuarios;operaciones se vuelven caras conforme crece la base de datos.

**Causa:**   no se modela límite/paginación ni una proyección/procesamiento por lotes.

**Solución:** índice/proyección batch, cursor/paginación, límite validado y orden determinista por `lastSample/observedAt`.

**Tests:** N buses, 1000 reports, cursor estable y respuesta con límite.

### P2P-002 — No hay TURN ni reconexión ICE real

**Archivos:** `src/sync/peer.ts:13-24`; `src/sync/index.ts:219-230`; `src/sync/invite.ts:30-34`  
**Función/componente:** `Peer` y emparejamiento  
**Estado:** Confirmado

**Problema:**   sólo se configuran dos STUN de Google.Al perder ICE, el peer marca `disconnected`/`reconnecting` pero no ejecuta `restartIce`, no crea nueva oferta y no tiene TURN.En redes móviles/NAT restrictivas el canal puede no establecerse o no recuperarse.

**Reproducción:** usar dos clientes en una red que bloquea UDP/STUN;simular `iceConnectionState=disconnected`.

**Impacto:**   fallo intermitente de pairing/trip-share y recuperación manual obligatoria.

**Causa:**   No hay TURN configurado ni una estrategia de reconexión automática.

**Solución:**ofrecer TURN gestionado, ICE restart con backoff/jitter,timeout y reconexión de peers persistidos.

**Tests:**simular estados ICE,NAT,STUN no disponible,después de una caída recuperar y repetir emparejamientos.

### AUTH-002 — Regenerar identidad no invalida el device key ni sesiones P2P

**Archivos:**`src/state/identity.ts:66-77,93-109,120-160`;`src/pages/Settings.tsx:574-584`  
**Función/componente:**`regenerate/reset`  
**Estado:**Confirmado

**Problema:**  `regenerate` sólo reemplaza la identidad Ed25519.`deviceKey` queda en IndexedDB y en memoria;`Settings` afirma que se desconectan dispositivos,pero no llama a `useSyncStore.reset()` ni invalida peers.`reset` tiene el mismo contrato(aclara que conserva device key).

**Reproducción:**regenerar identidad con un peer WebRTC activo;observar `useSyncStore`/device key en la consolao volver a establecer la conexión.

**Impacto:**  sesiones antiguas pueden conservar material de dispositivo y conectividad;el reset no cumple la promesa de desconexión.

**Causa:**  identidad de usuario y device identity no se gestionan como un único ciclo de vida.

**Solución:**botón separado para “cambiar identidad de usuario” y “borrar dispositivo”;invalidar peers,firmar revocation,rotar ECDH y confirmar persistencia.

**Tests:**regenerar,reset,peer activo,backup importado y reconexión posterior.

### DB-003 — El janitor borra shares activos y no es atómico

**Archivos:**`src/storage/janitor.ts:30-60`;`src/sync/tripShare.ts:275-311`  
**Función/componente:**`runJanitor`  
**Estado:**Confirmado

**Problema:**  la limpieza de `outgoingTripShares` borra por `startedAt` aunque el share siga activo;un viaje de más de siete días desaparece.Además,lecturas y deletes se hacen en transacciones separadas,no en una transacción de limpieza.

**Reproducción:**crear un share activo con `startedAt` mayor que el cutoff de siete días y ejecutar `runJanitor`.

**Impacto:**  pérdida de estado de los viajes compartidos/destinatarios y posible carrera con un update de `ack`.

**Causa:**  TTL se aplica a todas las filas salientes,no sólo a las terminadas;no se protege contra un update concurrente.

**Solución:**excluir activos,usar cursor/índice y transacción readwrite;considerar outbox/repair.

**Tests:**activo antiguo,compartido terminado,drainer concurrente y restore de sesión.

### CFG-001 — No hay CSP ni headers HTTP de seguridad

**Archivos:**`index.html:1-18`;`vite.config.ts:81-87`;`.github/workflows/prod.yml:122-132`  
**Función/componente:**despliegue GitHub Pages  
**Estado:**Confirmado

**Problema:**  no existe CSP,HSTS/headers de hardening,X-Content-Type-Options,Referrer-Policy,Permissions-Policy ni frame protection.GitHub Pages no tiene un archivo de headers configurado.Vite publica sourcemaps (`sourcemap: true`).

**Reproducción:**servir la build en GitHub Pages y consultar `curl -I`;inyectar un payload en Leaflet muestra el efecto agrava por falta de CSP.

**Impacto:**  reduce la defensa contra XSS/clickjacking y expone código fuente;no mitiga por sí solo FE-001,pero aumenta la gravedad.

**Causa:**  configuración estática sin política de seguridad ni proxy de headers.

**Solución:**CSP compatible con Vite/OSM/unpkg,headers en hosting/proxy,sourcemaps ocultos o no públicos,subresource integrity donde aplique.

**Tests:**curl de headers,Playwright con CSP,intentar recursos no permitidos y revisar artefactos publicados.

## Low Findings

### FE-011 — Eliminar un viaje compartido no persiste la eliminación

**Archivo:**`src/pages/Following.tsx:159-166`;`src/state/tripShare.ts:90-107`  
**Función/componente:**botón de eliminar `endedTrips`  
**Estado:**Confirmado

**Problema:**  `setSharedTrip(..., null)` sólo actualiza Zustand;no llama a `deleteIncomingShare` de IndexedDB.Tras recargar,la fila reaparece.

**Reproducción:**eliminar un viaje finalizado,salir y volver a Following.

**Impacto:**  borrado visualpero no persistido;el usuario cree que se eliminó de la interfaz,pero el dato sigue local.

**Causa:**  se usa setter reactivo en lugar de la operación de storage.

**Solución:**eliminar en DB y actualizar estado sólo después de éxito;mostrar error/reintento.

**Tests:**IDB delete,refresh,varias filas y fallo dealmacenamiento.

## Medium Findings

### IO-001 — Imágenes de parada sin límites ni validación de origen/tamaño

**Archivos:**`src/components/StopRequestSection.tsx:51-59,113-118,241-246,283-289`;`../portami-server/main.ts:349-370`  
**Función/componente:**`buttonPhotoUrl` y `NewBusReportForm`  
**Estado:**Confirmado

**Problema:**  se acepta cualquier `FileReader.readAsDataURL`,sin comprobar `file.type`,tamaño,dimensiones,URL remota o contenido real.El servidor tampoco valida.

**Reproducción:**seleccionar un archivo de decenas de MB o enviar un reporte con URL externa;cada visor puede solicitarla ypersistir GB de datos base64.

**Impacto:**  DoS de memoria/IndexedDB/KV,seguimiento hacia dominios externos y phishing visual;`javascript:` no es un riesgo de ejecución típico en `<img>`,pero no debe permitirse sin lista blanca.

**Causa:**  atributo `accept` del input se trata como validación y no hay canonicalización.

**Solución:**imagen local redimensionada/recodificada,límites de bytes/dimensiones,allow-list https/data:image y CSP `img-src`.

**Tests:**archivo no imagen,50 MB,SVG/data URL,URL externa y 0 bytes.

### IO-002 — Importación GeoJSON/backup acepta shapes demasiado superficiales

**Archivos:**`src/io/geojson.ts:138-163,256-264`;`src/io/identityBackup.ts:103-120`  
**Función/componente:**`importGeoJSON`,`pickFile`,`pickBackupFile`  
**Estado:**Confirmado

**Problema:**  `isPortamiExport` sólo comprueba `type`,`portami` y que `features` sea array;no valida `schemaVersion`,signatures,geometry,properties ni tamaño.`features` con `{}` provoca acceso a `props['kind']` y excepción no controlada.`pickFile` no resuelve Promise si el usuario cancela el selector.

**Reproducción:**importar `{type:"FeatureCollection",portami:{},features:[{}]}` o cerrar el file picker sin elegir archivo.

**Impacto:**  crash de import,consumo de memoria,datos corruptos y espera infinita en UI.

**Causa:**  validación estructuraldeclaraciónada pero no implementada de forma exhaustiva.

**Solución:**schema runtime,límite de bytes/elementos,validación de `portami.schemaVersion` y `input.oncancel`.

**Tests:**cada shape mínima,cancelación,JSON truncado,features huge y firma inválida.

### FE-012 — El cambio de idioma no actualiza `<html lang>` ni recarga la app

**Archivo:**`src/i18n/index.ts:7-15`;`src/pages/Settings.tsx:187-190`  
**Función/componente:**i18n  
**Estado:**Confirmado

**Problema:**  el comentario dice que `changeLanguage()` recarga la página,pero Settings sólo llama a `i18n.changeLanguage` y escribe localStorage.No se actualiza explícitamente el atributo `lang` del documento.

**Reproducción:**cambiar de es a ca y revisar `<html lang>`/títulos o visitar una pantalla montada después del cambio.

**Impacto:**  problema menor de accesibilidad,SEO y comportamiento inconsistente con el contrato documentado.

**Causa:**  documentación y comportamiento de Settings divergentes.

**Solución:**usar helper común para storage y sincronizar `document.documentElement.lang`,decidir explícitamente si hace falta reload.

**Tests:**cada locale,atributo HTML,persistencia y cambio tras montar una página nueva.

### FE-013 — Fallback de notificación e iconos con path absoluto

**Archivos:**`src/notify/index.ts:71-83`;`index.html:5`;`vite.config.ts:58-64`  
**Función/componente:**notificaciones PWA e iconos  
**Estado:**Confirmado

**Problema:**  el fallback `new Notification()` usa `/icons/icon-192.png` y `/icons/icon-192.png` sin convertirlo al `base`.En un despliegue bajo `/portami/`,la URL apunta a `https://host/icons/...` en vez de `/portami/icons/...`.Vite transforma el `<link>` del HTML,pero no estas cadenas de runtime.

**Reproducción:**instalar la PWA en GitHub Pages subpath,denegar el Service Worker temporalmente y mostrar una notificación.

**Impacto:**  iconos rotos,peor experiencia móvil y posible pérdida de confianza en la notificación.

**Causa:**  asset URL hard-coded en runtime en vez de una funciónbasada en scope/base.

**Solución:**resolver icon/badge mediante `new URL(..., document.baseURI)` o configuración de ruta,y cubrir fallback/subpath con test.

**Tests:**notificación foreground/background,subpath/root,SW no disponible.

## Medium Findings

### DEV-001 — Dependencias de desarrollo con vulnerabilidades conocidas

**Archivos:**`package.json:37-61`;`vite.config.ts:81-87`;`package-lock.json`  
**Función/componente:**Vite,Vitest,esbuild,React Router,vite-plugin-pwa  
**Estado:**Confirmado en el entorno auditado;exposición de producción no demostrada

**Problema:**  `npm audit` reporta:

- 1 critical:`vitest@2.1.9` / advisory de lectura/ejecución arbitraria de archivos cuando se usa el UI server.
- 1 high:`vite@5.4.21` / advisories de desarrollo del servidor.
- 6 moderate:`esbuild`,`react-router`/`react-router-dom`,`vite-node`,`@vitest/mocker`,`vite-plugin-pwa` transitivos.

El servidor de desarrollo escucha en `0.0.0.0`,lo que aumenta la superficie si un runner/dispositivo de red accesible.

**Impacto:**  en un entorno de desarrollo compartido,un atacante de la red podría intentar leer/ejecutar archivos o acceder al dev server;en el bundle de producción estas herramientas normalmente no se envían,pero la cadena de suministro queda expuesta.

**Causa:**  versiones antiguas y upgrades majors no planificados;`vite-plugin-pwa@0.20.5`ha sido auditado como vulnerable transitivo.

**Solución:**planificar una actualización compatible a Vite/Vitest/react-router,actualizar lockfile,restringir dev host a loopback salvo necesidad,añadir `npm audit`/SBOM al pipeline.

**Tests:**audit reproducible en CI,dev server desde localhost y red,y verificación de que el bundle de producción no contiene Vite/Vitest.

## Informational Findings

### INFO-001 — Dependencias/funciones anunciadas pero no utilizadas y packaging muerto

**Archivos:**`package.json:20-29`;`vite.config.ts:97-112`;`src/pages/Sync.tsx:31-53,167-205`;`README.md:14-16,81-88`  
**Función/componente:**QR,qrcode,react-leaflet,app version  
**Estado:**Confirmado

**Problema:**  `qrcode` no se importa y genera un chunk vacío de 45 bytes;“QR” en Sync sólo produce/copia SDP,no escanea/genera un QR real.`react-leaflet` está declarado pero la app usa Leaflet vanilla.`vite.config` hace chunk explícito de `qrcode`.La versión P2P se fija hard-coded en `0.1.0`.

**Impacto:**  deuda técnica,engaño de UX(la UI presenta QR como si el escaneo fuera funcional),bundle/advertisements innecesarios.

**Causa:**  dependenciasreservadas/roadmap no eliminados y copy de README desactualizado.

**Solución:**eliminar paquetes no usados o implementar de verdad la función;actualizar README/roadmap y derivar versión del package/build.

**Tests:**verificar que no haya chunks vacíos,que el flujo de pairing funcione con QR real si se anuncia,y que la versión publicada coincida con package.

## Authentication & Authorization Review

### Resultado

- No existe login,sesión,cookie de aplicación ni token clásico.
- El cliente firma Ed25519,pero el backend no verifica ningún header `X-Portami-*` ni extrae el sobre.
- Todos los endpoints mutables analizados carecen de autenticación, autorización y propiedad.
- No hay roles persistentes ni moderadores implementados.
- `WS /ws` es anónimo.
- `/admin/*` es público.
- Las claves privadas se guardan en IndexedDB sin cifrar.
- CORS tiene una allow-list,pero no es un sustituto de autenticación y no protege clientes no navigateur.

### Controles positivos

- El cliente genera un sobre con `pub/nonce/ts/body/sig` y canonicaliza JSON.
- ECDH + AES-GCM protege la transferencia de identidad P2P.
- El backup de identidad usa PBKDF2-SHA256 con 600.000 iteraciones y AES-GCM.
- La UI no envía credenciales en `fetch`(`credentials` por defecto).

## API Security Review

### Inventario de endpoints

| Método | Endpoint | Auth observada | Rate/validación | Finding relacionado |
|---|---|---|---|---|
| GET | `/health` | Pública | Sin rate limit;expone métricas | API-007 |
| POST | `/admin/status/:s` | Ninguna | Sin autenticación/autorización,binding contradice 0.0.0.0 | API-003 |
| POST | `/admin/restart-marker` | Ninguna | Sin autenticación/autorización | API-003 |
| GET | `/api/routes` | Pública | Sin paginación | PERF-002 |
| GET | `/api/routes/nearby` | Pública | `NaN` validado,Infinity no | API-009 |
| GET | `/api/routes/:id` | Pública | Sin autenticación/autorización de propietario;no es un secreto por diseño | API-005 |
| POST | `/api/routes` | Ninguna | Mass assignment/overwrite | API-001,API-004,FE-001 |
| GET | `/api/routes/:id/proposals` | Pública | Sin autenticación/autorización, paginación | API-007,PERF-002 |
| POST | `/api/routes/:id/proposals` | Ninguna | Sin autenticación/autorización; ruta no comprobada | API-001,API-009 |
| POST | `/api/proposals/:id/votes` | Ninguna | Sin votante/deduplicación/enum | API-001,API-006,DB-002 |
| POST | `/api/trips/start` | Ninguna | Signed envelope incompatible | API-001,API-005 |
| POST | `POST /api/trips/:id/samples` | Ninguna | `updateTrip` no comprobado | API-001,API-005 |
| GET | `/api/trips/:id` | Pública | IDOR potencial | API-005 |
| POST | `/api/trips/:id/end` | Ninguna | broadcast incluso si falla | API-001,API-005,FE-003 |
| GET | `/api/routes/:id/active-buses` | Pública | Streams públicos;sin autenticación/autorización WS | API-002,PERF-002 |
| GET | `/api/active-buses` | Pública | N+1 `getRoute` | PERF-002 |
| POST | `/api/detours` | Ninguna | Sin autenticación/autorización/size/schema | API-007,API-009 |
| POST | `/api/incidents` | Ninguna | Sin autenticación, autorización ni validación | API-001,API-007,API-009 |
| GET | `/api/incidents` | Pública | Sin autenticación/autorización/paginación | API-007,PERF-002 |
| POST | `/api/incidents/:id/resolve` | Ninguna | Sin comprobación de existencia/owner | API-008 |
| PUT | `/api/routes/:id/stop-request` | Ninguna | `confirmations`/photo arbitrarios | API-001,API-004,API-009 |
| GET | `/api/routes/:id/bus-reports` | Pública | `limit` sin clamp | API-007,PERF-002 |
| POST | `/api/routes/:id/bus-reports` | Ninguna | Sin autenticación/autorización/photo/size | API-001,IO-001,API-009 |
| POST | `/api/journey-plan` | Pública | CPU/input sin límites | API-007,API-009,PERF-002 |
| WS | `/ws` | Ninguna | Sin autenticación/autorización/subscription cap | API-002 |

## Frontend Security Review

### XSS y renderizado

- La aplicación no usa `dangerouslySetInnerHTML`,pero Leaflet sí convierte strings a `innerHTML`.
- FE-001 es una XSS almacenada confirmada y comprometible a través de datos no confiables.
- No hay CSP;esto debe corregirse como defensa en profundidad.
- Las URLs de notificación,links externos y share intents no son actualmente un vector confirmado de open redirect,pero `notify`/SW aceptan `url` y deben validarse contra el scope de la app.

### Almacenamiento local

- `localStorage`:flags `portami.collaborate`,idioma y testing;no contiene la clave privada.
- `IndexedDB`:contiene JWK privados,grabaciones,rutas,propuestas,shares,alertas,device key y posible cola vacía.
- El cifrado de backups no protege la clave mientras está activa en IndexedDB.
- Los servicios externos OSM/unpkg se cargan en runtime;Leaflet depende de `unpkg.com` para sus iconos por defecto.

### Privacidad

- GPS al servidor sólo se envía cuando `collaborate.enabled` es true;el test unitario cubre on/off.
- Esa regla se rompe operativamente si varias features comparten el watcher,si el servidor ignora firma y si `endTrip`termina localmente con éxito mientras servidor queda activo.
- El backend expone buses activos y trip IDs públicamente;el WebSocket agrava lafiltración.

## Database Review

### Deno KV / MemoryStore

- KV usa claves por prefijo para rutas/propuestas/incidencias/reportes/trips.
- No hay claves foráneas; se permite crear propuestas/viajes/reportes de buses contra rutas inexistentes.
- Hay índices,pero no paginación.
- `MemoryStore` no tiene persistencia y se selecciona silenciosamente si KV falla.
- La API de actualización no es atómica(DB-002).

### IndexedDB

- Schema v1/v2;las migraciones no tienen tests directos.
- `pendingSamples` tiene key collision(DB/FE-004).
- Las mutaciones de trip share son `get` + `put` no transaccionales.
- El janitor puede borrar shares activos(DB-003).

## Concurrency Review

- `useIdentityStore.init` y `useDeviceKeyStore.ensure` no tienen promesa de inicialización compartida; dos llamadas concurrentes pueden generar dos pares y dejar el estado/IDB inconsistente (AUTH-003).
- Los mensajes P2P transportan metadatos `fromAnonId`/`fromDeviceId` sin firma a nivel de aplicación; un par comprometido puede suplantar otro sender (P2P-003).
- `updateOutgoingRecipient`/janitor/importaciones pueden perder updates por get-modify-put.
- El retry/timeout de API no tiene idempotencia.
- Votos,samples y stop request son especialmente sensibles a lost updates.
- `useInterval` no evita ticks solapados.
- P2P tiene un bug de identificadores(P2P-001)y no reconexión real(P2P-002).
- El storage local no usa transactions para operaciones de lectura-escritura-mutación.

## Error Handling Review

- JSON malformado en backend termina en 500(API-009).
- RouteDetaildescarta errores de carga y queda en skeleton(FE-007).
- Record convierte 400/401/500 en “offline”(FE-006).
- `apiFetch` reintenta 4xx/5xx y no cancela requests lentos(API-010).
- `Journey.handleStart`,`StopRequestSection.save` y `StopRequestSection.submitReport` no tienen catch de UI;promises rechazadas pueden quedar sin manejar.
- Los tests de health aceptan cualquier estado y el test de testing tiene un `expect(true)` sin probar el rechazo real(QA-001).
- `apiFetch` no distingue saturado de caído para `failFastIfOffline`;sólo bloquea `offline`,no `stopped`.

## Performance Review

- Leaflet bundle:149.64 kB sin gzip;vendor React:167.97 kB;app principal:458.69 kB;gzip total aproximado ~284 kB para los tres,más páginas.
- `react-leaflet` declarado pero no usado;`qrcode` genera chunk vacío.
- `listActiveBuses` hace N `getRoute`;`listBusReports` carga/ordena todo.
- Journey mantiene arrays,usa `queue.sort` y no tiene límite efectivo de `maxBoardings`.
- Los pollees no pausan en background.
- La cola GPS inexistente evita reintentos pero pierde datos,no es una optimización.
- OSM tiles se cachean con Workbox;upkg icons se resuelven en runtime sin fallback local/SRI.

## Dependency Review

- Lockfile presente y completo(696 paquetes transitivos).
- `npm audit`:8 vulnerabilidades(1 critical,1 high,6 moderate).Las versiones corregidas requieren cambios majors;no se aplicó `npm audit fix --force`.
- Vulnerabilidades principales:`vitest` critical,Vite high,esbuild moderate,react-router moderate,vite-plugin-pwa transitivo.
- Deno.lock: Hono 4.13.5,std/assert 1.0.19 con integrity;no se identificó una forma de auditar automáticamente avisos Deno desde el lockfile.
- `sourcemap: true` y `dist/assets/*.map` potencialmente públicos.
- `vite.config.ts` fuerza chunks `qrcode` aunque la dependencia no se usa;`react-leaflet` también está en el grafo aunque LeafletMap importa `leaflet` directamente.
- `vite` y preview escuchan en `0.0.0.0`;para desarrollo conviene loopback salvo un runner aislado.

## Testing Gaps / Low Findings

### Tests existentes

- Frontend: 183 unit tests y 6 Chromium E2E;todos pasan.
- Backend: 21 Deno tests;todos pasan.
- Cubren crypto,distance,schedule,trip detector,basic trip store,IDB CRUD,pairing helpers,invite parsers,MSW bootstrap y privacidad collaborate on/off.
- E2E cubre boot,navegación,Board,backup,idiomas y textos de privacidad;no ejecuta el backend real.

### Gaps críticos

1. No hay tests del contrato `SignedEnvelope` contra el backend real.
2. No hay auth/propiedad tests para ningún POST/PUT ni WebSocket.
3. No hay tests de XSS/Leaflet con nombres/anonIds maliciosos.
4. No hay tests de WebRTC real,reconexión,STUN/TURN,mapa de peers ni ACK end-to-end.
5. El hook `useTripShareBridge` completo(effects,timers,retry,unmount,strict mode)no está cubierto;sus tests son mayormente helpers puros.
6. No hay tests de `src/sw.ts`,caché/notification URL,subpath/icon fallback.
7. No hay tests de migraciones IndexedDB v1/v2 ni de storage concurrente real.
8. `tests/testing.test.ts:46-56` tiene un `expect(true).toBe(true)` y no prueba la invalidación real.
9. `tests/health.test.tsx:82` acepta `stopped|offline|normal|saturated`,por lo que puede pasar sin verificar el estado esperado.
10. No hay cobertura medida:no existe script `coverage` ni `coverageThreshold`.
11. CI hace unit/type/lint/audit en un job y E2E en otro;prod workflow no ejecuta E2E ni `npm audit`.
12. El build de producción pasa,pero no se prueba contra Deno Deploy,base `/portami/`,fallos de CORS ni headers HTTP.
13. `git diff --check` detecta una línea en blanco preexistente al final de `src/pages/Trip.tsx:410`; no se corrigió durante la auditoría.

### QA-001 — Tests y CI no cubren la superficie crítica

**Archivos:** `package.json:7-18`; `.github/workflows/ci.yml:16-78`; `.github/workflows/prod.yml:23-132`; `tests/testing.test.ts:46-56`; `tests/health.test.tsx:82`  
**Función/componente:** cobertura, CI y calidad de pruebas  
**Estado:** Confirmado

**Problema:** no existe script de cobertura ni `coverageThreshold`; el workflow de producción no ejecuta `npm audit` ni E2E; el test de testing deja un `expect(true)` sin probar la invalidación real; el test de health acepta un estado sin verificar el esperado.

**Reproducción:** revisar `package.json`/`vite.config.ts` y ejecutar los workflows;`npm audit` sólo aparece en CI, mientras que el test `testing` no comprueba el caso que declara probar.

**Impacto:** regresiones de auth, XSS, WebSocket, P2P, migraciones, Service Worker y errores de servidor pueden llegar a producción sin ser detectadas.

**Causa:** la suite se concentra en helpers/mocks y la CI separa el gate E2E del gate de build; además, el workflow de despliegue no repite las comprobaciones de calidad.

**Solución:** añadir cobertura instrumentada, tests de contrato del backend real, auth/ownership por endpoint, seguridad Leaflet, WebRTC, SW, IndexedDB concurrente y CI con audit/E2E en todos los despliegues; eliminar aserciones permisivas.

**Tests recomendados:** ejecutar los 12 gaps de `Testing Gaps` como tests reales, no sólo como comprobaciones de helpers.

## Recommended Fix Priority

### P0 — antes de producción

1. Corregir API-001: desarrollar un único contrato firmado, verificar firma/timestamp/nonce, derivar campos del sobre y rechazar body directo.
2. Corregir FE-001: eliminar HTML de Leaflet, sanitizar, añadir CSP y threat model de claves.
3. Corregir FE-014: usar el base path real en invitaciones, SW y navegación, y cubrir root/subpath.
4. Eliminar/acorazar WebSocket anónimo y endpoints admin.
5. Añadir propiedad a rutas, propuestas, viajes, incidencias, stop-request y reportes de buses.
6. Corregir P2P-001 y hacer que trip-share sea operable end-to-end.

### P1 — antes de beta pública

7. Corregir FE-002 propiedad del GeoWatcher, FE-003 endTrip y FE-004 cola GPS.
8. Añadir rate limiting, paginación, límites de payload y KV readiness; eliminar fallback accidental a memoria.
9. Implementar transacciones/idempotencia/deduplicación de votos y resolver incidente correctamente.
10. Corregir errores de UI, plannedRoute, ruta synthetic, timezone, ETA y la discrepancia de `/routes/nearby` (API-011).
11. Añadir CSP/headers/sourcemaps controlados y empaquetado local de iconos.

### P2 — calidad y compatibilidad

12. Eliminar dependencias no usadas, implementar QR real o corregir copy/documentación, actualizar versiones majors con pruebas.
13. Añadir cobertura y tests de contratos, WebRTC, Service Worker, IndexedDB concurrente y backend real.
14. Persistir eliminación de Following, validar archivos/imágenes, mejorar feedback de i18n y fallback de iconos.

## Top 10 bugs/vulnerabilidades prioritarios

1. **FE-001 — XSS almacenada en tooltips de Leaflet** (`src/components/LeafletMap.tsx:139,144,200`).
2. **API-001 — Protocolo de sobre firmado incompatible con el backend** (`src/api/client.ts:65-87`; `../portami-server/main.ts:148-370`).
3. **API-002 — WebSocket anónimo para suscribirse a viajes** (`../portami-server/main.ts:404-410`; `../portami-server/ws.ts:48-69`).
4. **API-003 — Administración pública en `0.0.0.0`** (`../portami-server/main.ts:102-113,404`).
5. **API-004 — Mass assignment/overwrite de rutas y campos colaborativos** (`../portami-server/main.ts:148-155`).
6. **API-005 — IDOR y falsos `204` en muestras/finalización de viajes** (`../portami-server/main.ts:201-237`).
7. **API-006 — Votos anónimos, duplicables y no atómicos** (`../portami-server/main.ts:164-198`).
8. **P2P-001 — Identificadores incompatibles rompen `trip-share`** (`src/sync/index.ts:160-397`; `src/sync/tripShare.ts:95-105,341-483`).
9. **FE-014 — `import.meta.env.BASE_PATH` rompe enlaces/navegación P2P** (`src/sync/invite.ts:107,162`; `src/App.tsx:64-78`).
10. **AUTH-001 — JWK privados sin cifrar en IndexedDB** (`src/crypto/index.ts:106-112`; `src/storage/db.ts:18-29`).


| ID | Severidad | Área | Problema | Archivo | Estado |
|---|---|---|---|---|---|
| FE-001 | CRITICAL | Frontend/XSS | Tooltips Leaflet insertan HTML de servidor sin sanitizar | `src/components/LeafletMap.tsx:139,144,200`; `../portami-server/main.ts:148-155` | Confirmado |
| API-001 | CRITICAL | API/Auth | Cliente envía sobre firmado;backend espera body directo y no verifica firma | `src/api/client.ts:65-87`; `../portami-server/main.ts:148-370` | Confirmado |
| API-002 | HIGH | API/Privacidad | Suscripción WebSocket a cualquier trip sin autenticación/autorización | `../portami-server/main.ts:404-410`; `../portami-server/ws.ts:48-69` | Confirmado |
| API-003 | HIGH | API/Operación | Endpoints admin públicos en servidor 0.0.0.0 | `../portami-server/main.ts:102-113,404` | Confirmado |
| API-004 | HIGH | API/Autorización | Mass assignment/overwrite de rutas y campos colaborativos | `../portami-server/main.ts:148-155`; `../portami-server/db.ts:58-60` | Confirmado |
| API-005 | HIGH | API/IDOR | Cualquiera puede sample/end/get trip y recibe falsos 204 | `../portami-server/main.ts:201-237` | Confirmado |
| API-006 | HIGH | API/Gobernanza | Votos anónimos,sin deduplicación ni autorización | `../portami-server/main.ts:164-198`; `../portami-server/types.ts:104-110` | Confirmado |
| P2P-001 | HIGH | P2P/Routing | `deviceId` UUID,`pubKey` y map keys incompatibles;trip-share no enruta | `src/state/identity.ts:130-160`; `src/sync/index.ts:160-397`; `src/sync/tripShare.ts:95-105,341-483` | Confirmado |
| FE-002 | HIGH | GPS/Estado | Singleton GeoWatcher detiene/reasigna watchers entre features | `src/geo/watcher.ts:172-199,206-251`; `src/pages/Explore.tsx:43-60`; `src/pages/Record.tsx:77-90` | Confirmado |
| FE-003 | HIGH | Persistencia/UX | End local exitoso deja viaje activo en servidor si API falla | `src/state/trip.ts:48-65`; `../portami-server/main.ts:233-237` | Confirmado |
| AUTH-001 | HIGH | Auth/Almacenamiento | Claves privadas JWK sin cifrar en IndexedDB | `src/crypto/index.ts:106-112`; `src/storage/db.ts:18-29` | Confirmado |
| DB-001 | HIGH | Persistencia | KV no adjunto activa MemoryStore y pierde todo al reiniciar | `../portami-server/db.ts:277-307` | POTENTIAL |
| API-007 | HIGH | Disponibilidad | Sin rate limiting ni cuotas | `../portami-server/main.ts:55-82` | Confirmado |
| DB-002 | HIGH | Concurrencia | Get+set no atómico en trips/proposals/stop request | `../portami-server/db.ts:61-81,105-113` | Confirmado |
| API-008 | HIGH | API/Autorización | Resolver incidencia sin owner y 200 para ID inexistente | `../portami-server/main.ts:323-327` | Confirmado |
| FE-014 | HIGH | P2P/Deep-links | Base path Vite incorrecto rompe invitaciones y navegación P2P | `src/sync/invite.ts:107,162`; `src/App.tsx:64-78`; `src/components/InviteModal.tsx:60-66` | Confirmado |
| API-009 | MEDIUM | Validación | JSON/query/bodies sin esquema;malformed JSON=500 e Infinity=200 | `../portami-server/main.ts:121-138,289-379` | Confirmado |
| FE-004 | MEDIUM | Offline/Persistencia | Cola GPS no implementada;store colisiona por tripId | `src/storage/db.ts:91-96,193-197`; `src/geo/watcher.ts:254-265` | Confirmado |
| FE-005 | MEDIUM | Lifecycle | Listener de Record queda vivo al desmontar | `src/pages/Record.tsx:45-50,77-83` | Confirmado |
| API-010 | MEDIUM | API/Errores | Retry indiscriminado,sin timeout/idempotency | `src/api/client.ts:97-131` | Confirmado |
| API-011 | MEDIUM | API/Integración | `/routes/nearby` tiene semántica distinta en MSW y backend | `mocks/handlers.ts:23-35`; `../portami-server/main.ts:121-138` | Confirmado |
| P2P-003 | MEDIUM | P2P/Integridad | Metadatos de identidad de mensajes P2P no están firmados | `src/sync/peer.ts:46-57`; `src/sync/index.ts:252-260`; `src/sync/tripShare.ts:79-105` | POTENTIAL |
| AUTH-003 | MEDIUM | Auth/Concurrencia | Inicialización concurrente de claves puede generar material inconsistente | `src/state/identity.ts:43-63,130-160` | Confirmado |
| FE-006 | MEDIUM | Errores/UX | Record convierte 400/401/500 en offline | `src/pages/Record.tsx:163-205` | Confirmado |
| FE-007 | MEDIUM | Errores/UI | RouteDetail queda en skeleton infinito | `src/pages/RouteDetail.tsx:117-130,217-225` | Confirmado |
| FE-008 | MEDIUM | Autorización UI | Compara pubKey con reportedBy anonId;botón resolver nunca aparece | `src/pages/RouteDetail.tsx:110-112,331-337` | Confirmado |
| FE-009 | MEDIUM | P2P/Funcionalidad | plannedRoute no se pasa al bridge | `src/state/trip.ts:13-16`; `src/sync/tripShare.ts:51-62`; `src/pages/Trip.tsx:112-122` | Confirmado |
| FE-010 | MEDIUM | Journey | Inicia viaje con ruta sintética de polyline vacío/coordenadas 0,0 | `src/pages/Journey.tsx:273-289` | Confirmado |
| APP-001 | MEDIUM | Schedules | Frontend usa hora local;backend UTC | `src/geo/schedule.ts:19-35`; `../portami-server/journey.ts:30-41` | Confirmado |
| GEO-001 | MEDIUM | ETA | Distancia no acumulada yorden incorrecto | `src/geo/eta.ts:29-61` | Confirmado |
| PERF-001 | MEDIUM | Rendimiento/Batería | Intervalos no pausan en background y se solapan | `src/hooks/useInterval.ts:1-7,50-67`; `src/pages/Explore.tsx:63-80` | Confirmado |
| PERF-002 | MEDIUM | Backend/Rendimiento | N+1 y listas sin paginación | `../portami-server/main.ts:257-270`; `../portami-server/db.ts:148-151,257-268` | Confirmado |
| P2P-002 | MEDIUM | P2P/Red | Sin TURN ni reconexión ICE | `src/sync/peer.ts:13-24`; `src/sync/index.ts:219-230` | Confirmado |
| AUTH-002 | MEDIUM | Auth/P2P | Regenerar identidad no invalida device key ni peers | `src/state/identity.ts:66-77,93-160`; `src/pages/Settings.tsx:574-584` | Confirmado |
| DB-003 | MEDIUM | Persistencia | Janitor borra shares activos y no es transaccional | `src/storage/janitor.ts:30-60` | Confirmado |
| CFG-001 | MEDIUM | Headers/XSS | Sin CSP ni security headers;sourcemaps públicos | `index.html:1-18`; `vite.config.ts:81-87` | Confirmado |
| FE-011 | LOW | Persistencia/UI | Eliminar Following no borra IndexedDB | `src/pages/Following.tsx:159-166` | Confirmado |
| IO-001 | MEDIUM | Imágenes/DoS | Foto sin MIME/tamaño/origen;base64/URL arbitraria | `src/components/StopRequestSection.tsx:51-59,241-289`; `../portami-server/main.ts:349-370` | Confirmado |
| IO-002 | LOW | Importación | GeoJSON/backup shallow validation y picker cancelable pendiente | `src/io/geojson.ts:138-163,256-264`; `src/io/identityBackup.ts:103-120` | Confirmado |
| FE-012 | LOW | i18n/Accesibilidad | Cambio de idioma no actualiza html lang/reload documentado | `src/i18n/index.ts:7-15`; `src/pages/Settings.tsx:187-190` | Confirmado |
| FE-013 | LOW | PWA/Mobile | Fallback notification usa icono con path absoluto bajo subpath | `src/notify/index.ts:71-83` | Confirmado |
| DEV-001 | MEDIUM | Supply chain | Vite/Vitest/esbuild/react-router advisories;1 critical,1 high,6 moderate | `package.json:37-61`; `vite.config.ts:81-87`; `package-lock.json` | Confirmado en dev |
| QA-001 | LOW | Tests/CI | Sin coverage real,tests permisivos,prod sin audit/E2E | `package.json:7-18`; `tests/testing.test.ts:46-56`; `tests/health.test.tsx:82`; `.github/workflows/prod.yml:45-77` | Confirmado |
| INFO-001 | INFO | Packaging/UX | QR no funcional,qrcode/react-leaflet sin uso,appVersion hard-coded | `package.json:20-29`; `vite.config.ts:97-112`; `src/pages/Sync.tsx:31-53,167-205` | Confirmado |

## Valoración general

**Estado del proyecto:** experimental, no listo para producción abierta.

Los tests y el tipado dan una base de mantenimiento decente,pero están midiendo principalmente helpers y mocks,no la seguridad del sistema distribuido.La prioridad no debe ser añadir más features:hay que cerrar primero la frontera de confianza(firma/autorización),eliminar la XSS,hacer persistente/idempotente el flujo de viajes yrediseñar los identificadores P2P.Después de esos cambios,la aplicación debería añadir tests de contrato contra el backend real,paginación/límites y cobertura de errores para evitar que los fallos vuelvan a producción.
