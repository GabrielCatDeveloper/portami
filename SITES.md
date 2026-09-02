# SITES — Registro de despliegue y rotación de URLs

> Documento persistente. Cuando cambien URLs, credenciales,
> certificados o hosts del server, este archivo debe actualizarse
> **al mismo tiempo** que el código.

## Frontend (`portami/`)

- **Tipo**: PWA estática (Vite + Workbox SW)
- **Hosting**: GitHub Pages, rama `prod`
- **CI**: `.github/workflows/ci.yml` (typecheck/lint/test/audit) +
  `.github/workflows/prod.yml` (build + deploy)
- **Ruta base**: `VITE_BASE_PATH` (en CI = `/portami/`, en dev = `/`)

### URL de producción
- **Frontend**: `https://gabrielcatdeveloper.github.io/portami/`
- **API (server)**: `https://portami-server-6mv9bn5jhvvb.gabrielcatdev.deno.net/`

## Server (`../portami-server`)

- **Tipo**: Deno + Deno Deploy
- **Lenguaje**: TypeScript
- **Runtime**: Deno (no Node)
- **Almacenamiento**: Deno KV
- **Sin autenticación** (firma Ed25519 de cada POST no-GET)

> **Importante**: el server vive en un **repo hermano** (`../portami-server`),
> NO en este repo. Cualquier cambio de endpoint, modelo de datos o
> lógica de negocio del server se hace ahí.

### Cuando el server se redeploya

Si el server se redeploya bajo un **nuevo hostname** (típico en
Deno Deploy: cada "deployment" puede recibir un subdominio aleatorio
o se le asigna un custom domain), hay que actualizar **estos dos
sitios en el frontend**:

1. `.github/workflows/prod.yml` línea ~76:
   ```yaml
   env:
     VITE_API_BASE: https://<nuevo-hostname>/
   ```
2. `.env.example` línea ~4:
   ```
   #     VITE_API_BASE=https://<nuevo-hostname>
   ```

Después de cambiar `VITE_API_BASE`, **re-ejecutar el workflow de
deploy** (`Actions → "Build & Deploy (prod)" → Run workflow`)
para publicar el bundle con la URL nueva.

### Cuando el server cambia el wire format

Si el server añade/quita/renombra campos en la respuesta de
cualquier endpoint:

1. Actualizar el tipo correspondiente en `src/api/types.ts`
2. Actualizar la respuesta mock en `mocks/handlers.ts` para que
   coincida (es la fuente de verdad del contrato durante dev)
3. Si el cambio es breaking, bumpear `VITE_API_BASE` con un query
   param `?v=N` no — mejor: desplegar el server primero y luego
   el cliente, asumiendo que el server mantiene compat hacia atrás
   durante la ventana de deploy

## Cómo se relacionan los dos repos

```
portami/                 (frontend, este repo)
├── src/api/              ← cliente HTTP (apiFetch)
├── mocks/handlers.ts     ← MSW, fuente de verdad del wire format
└── public/locales/       ← i18n

../portami-server/        (backend, repo hermano)
├── main.ts               ← entrypoint Deno
├── db.ts                 ← Deno KV schema (espejo de storage/db.ts del cliente)
├── ws.ts                 ← WebSocket relay (futuro, no usado todavía)
├── tests/                ← tests del server
└── deno.json             ← tareas Deno
```

El cliente **nunca** debe importar nada del server. La única fuente
de verdad del contrato es:

- `src/api/types.ts` (tipos TypeScript del cliente)
- `mocks/handlers.ts` (comportamiento esperado de cada endpoint)

Si cambias algo en el server, asegúrate de que estos dos archivos
del cliente siguen reflejando el nuevo contrato. Si no, el build
de TypeScript seguirá pasando pero las llamadas fallarán en
runtime.

## Tests de contrato (futuro)

Para evitar drift silencioso, se podría añadir un **consumer-driven
contract test**:

- En el cliente, generar un OpenAPI/JSON-Schema a partir de
  `mocks/handlers.ts` y los tipos
- En CI, hacer un `fetch` real contra el server y validar que
  cumple el schema

Esto está fuera del alcance actual (Hito "no priorizado" en
`ROADMAP_FUTURE.md`); mientras no exista, los cambios del server
se validan manualmente ejecutando el flujo de Board → Trip →
End en el frontend contra el server desplegado.
