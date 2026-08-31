# portami — roadmap

## Estado actual (noviembre 2026)

App PWA desplegada en GitHub Pages. El server está en `https://portami-server-myqe6vtk46ha.gabrielcatdev.deno.net/`.

- Idioma: es / ca / en
- Identidad anónima (Ed25519), backup cifrado con passphrase
- Import/Export GeoJSON firmado
- WebRTC P2P entre dispositivos emparejados (clave + propuestas + rutas + compartir viaje con GPS cada 60s)
- Notificaciones locales (llegada a parada, propuestas aprobadas, alertas fuertes con vibración+sonido)
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

## Próximos hitos de la app

### Hito 7 — Mejoras de live tracking

- ETA más preciso basado en velocidad histórica del bus (no solo la del último sample).
- Modo "vista bus" en el mapa: el bus como elemento central con la ruta detrás.
- Botón "ya llegué" en Trip que finaliza el viaje cuando estás dentro de 30 m del destino.

### Hito 8 — Mejoras de notificaciones

- Configuración de notificaciones (qué alertas quiere el usuario).
- Modo "no molestar" (horario nocturno).
- Resumen diario: "hoy cogiste 2 buses, recorriste 12 km".

### Hito 9 — App nativa opcional

- Tauri o Capacitor para iOS/Android nativo (mejor geofencing, push real).

## Cómo pruebo el conjunto

```bash
# App con server local
cd ../portami-server && deno task start    # http://localhost:8000
cd portami && VITE_API_BASE=http://localhost:8000 npm run dev

# App sin server (modo offline puro)
npm run dev    # MSW intercepta todo
```
