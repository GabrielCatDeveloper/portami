# WebMCP — Model Context Protocol for portami

portami exposes its full UI as **tools** consumable by any agent
that speaks the [W3C WebMCP](https://webmachinelearning.github.io/webmcp/)
standard (Claude, ChatGPT, Gemini, Cursor, etc.). This means an
agent connected to the running PWA can **do anything a user can
do in the UI** — start a trip, share it with friends, propose a
route edit, report an incident, send a rescue-me alert, etc. —
all through structured tool calls.

> **WebMCP** is the browser-native MCP: pages publish tools via
> `document.modelContext.registerTool(...)` and any connected agent
> can discover and call them.

---

## How it works

1. `main.tsx` calls `initWebMcp()` once after the identity has been
   initialised.
   - On Chrome 146+ `document.modelContext` is native → no extra work.
   - Everywhere else we lazy-load
     [`@mcp-b/global`](https://www.npmjs.com/package/@mcp-b/global),
     which polyfills `document.modelContext` and bridges to a
     connected MCP client over a `TabServerTransport`.
2. `registerAllTools()` then registers every tool defined under
   `src/webmcp/tools/` against the bridge. The total is **70 tools**
   (asserted by `tests/webmcp.test.ts`).
3. The Trip-share controller's always-on loops (incoming-message
   listener, location broadcaster, peer-status retry) are installed
   in `App.tsx` so an agent can `start_trip_share` regardless of
   which page the user is on.

The polyfill is split into its own chunk by Vite, so the cost on
browsers with native WebMCP is ~0 KB.

---

## Tool catalogue

All tool names are `snake_case`. Tools annotated with
`readOnlyHint: true` are pure reads and safe to call without user
confirmation.

### Identity (`src/webmcp/tools/identity.ts`)

| Tool | Read | Notes |
|---|---|---|
| `get_identity` | ✓ | Returns `{anonId, pubKey, createdAt}`. Never exposes the private key. |
| `export_identity_jwk` | | Returns the raw Ed25519 private JWK. Handle with care. |
| `import_identity_jwk` | | Replaces the current identity. ⚠️ Destructive. |
| `regenerate_identity` | | Generates a new keypair. ⚠️ Destructive (loses votes, trust). |
| `reset_identity` | | Wipes identity + ALL local data. ⚠️⚠️ Very destructive. |
| `export_identity_backup_file` | | Returns a passphrase-protected backup (PBKDF2 600k + AES-GCM). |
| `import_identity_backup_file` | | Restores from a backup. ⚠️ Destructive. |

### Routes (`src/webmcp/tools/routes.ts`)

| Tool | Read | Notes |
|---|---|---|
| `list_routes` | ✓ | Local cache; filters: `onlyMine`, `onlyFavorites`, `vehicleKind`, `query`, `limit`. |
| `get_route` | ✓ | Single route by id. |
| `find_routes_nearby` | | Server query, merged into local cache. |
| `mark_route_favorite` | | Toggle the favourite flag on a route. |
| `get_active_buses` | ✓ | Live buses (optionally filtered by `routeId`). |
| `get_stop_request` | ✓ | Read the stop-request info (button/shout/app) for a route. |
| `set_stop_request` | | Propose new stop-request info. |

### Proposals (`src/webmcp/tools/proposals.ts`)

| Tool | Read | Notes |
|---|---|---|
| `list_proposals` | | Server query, merged into local cache. Filter by `status`. |
| `get_proposal` | ✓ | Single proposal by id. |
| `create_proposal` | | Submit a RouteDiff array. See `list_proposal_diff_kinds`. |
| `vote_proposal` | | Approve / reject. One vote per proposal. |
| `list_proposal_diff_kinds` | ✓ | The supported diff kinds. |

### Trips (`src/webmcp/tools/trips.ts`)

| Tool | Read | Notes |
|---|---|---|
| `get_active_trip` | ✓ | Active trip + route + last sample + phase. |
| `start_trip` | | Requires the route to be in cache. Signed `POST /trips/start`. |
| `end_trip` | | Ends the active trip. Reasons: `manual`, `heuristic`, `arrival`. |
| `list_recent_trips` | ✓ | Local trip history (newest first). |
| `push_gps_sample` | | Signed `POST /trips/:id/samples`. Requires active trip. |

### Trip share — P2P with friends (`src/webmcp/tools/tripShare.ts`)

| Tool | Read | Notes |
|---|---|---|
| `start_trip_share` | | Begin broadcasting the active trip to paired peers. |
| `stop_trip_share` | | Stop broadcasting. Reasons: `manual`, `heuristic`, `arrival`, `trip-ended`. |
| `get_outgoing_share` | ✓ | Current outgoing share or `null`. |
| `list_incoming_shares` | ✓ | Friends' active + recent shared trips. |
| `list_outgoing_share_history` | ✓ | Last 20 outgoing shares. |
| `retry_trip_share_recipient` | | Manually retry sending to one peer. |
| `get_friend_location` | ✓ | Latest location received from a friend. |
| `remove_incoming_share` | | Drop the local record of an incoming share. |
| `is_sharing` | ✓ | Boolean. |
| `list_peer_statuses` | ✓ | WebRTC state of every paired peer. |

### Pairing — WebRTC device pairing (`src/webmcp/tools/pairing.ts`)

| Tool | Read | Notes |
|---|---|---|
| `list_paired_devices` | ✓ | All paired WebRTC devices. |
| `revoke_paired_device` | | Remove a paired device. ⚠️ Destructive (requires re-pairing). |
| `create_pairing_offer` | | Initiator: produce an SDP offer. |
| `join_with_pairing_offer` | | Joiner: produce an SDP answer from an offer. |
| `finish_pairing_as_initiator` | | Initiator: accept the joiner's answer. |
| `reset_pairing` | | Abort the current pairing flow. |
| `get_pairing_status` | ✓ | Current phase, pair code, progress. |
| `create_invite_link` | | Produce a `/connect` deeplink + share text. |
| `build_answer_back_url` | | Build the `/connect-back` URL for the joiner to send back. |

### Journey planning (`src/webmcp/tools/journey.ts`)

| Tool | Read | Notes |
|---|---|---|
| `plan_journey` | | A → B with transfers. Server query. |

### Incidents (`src/webmcp/tools/incidents.ts`)

| Tool | Read | Notes |
|---|---|---|
| `list_incidents` | ✓ | Active incidents (optionally filtered by `routeId`). |
| `report_incident` | | Report cancellation/delay/diversion/other. Signed. |
| `resolve_incident` | | Mark an incident resolved. Signed. |

### Stop alerts (`src/webmcp/tools/stopAlerts.ts`)

| Tool | Read | Notes |
|---|---|---|
| `list_stop_alerts` | ✓ | Local alerts (filter by `routeId` or omit for all). |
| `add_stop_alert` | | Add a time- or distance-triggered alert. |
| `remove_stop_alert` | | Delete by id. |
| `reset_stop_alerts_for_route` | | Re-arm alerts so they fire on the next trip. |
| `clear_stop_alerts` | | Delete every alert. ⚠️ Destructive. |

### Settings (`src/webmcp/tools/settings.ts`)

| Tool | Read | Notes |
|---|---|---|
| `get_settings` | ✓ | Language, collaborate, testing, server health. |
| `set_collaborate_enabled` | | Toggle "GPS to server" flag. Persists in localStorage. |
| `set_testing_mode` | | Toggle MSW + synthetic GPS. Reload recommended. |
| `set_language` | | `es` / `ca` / `en`. Reload recommended. |

### Geo (`src/webmcp/tools/geo.ts`)

| Tool | Read | Notes |
|---|---|---|
| `get_current_position` | ✓ | Returns the latest GPS sample (waits up to 15s). |
| `get_geolocation_permission` | ✓ | `granted` / `denied` / `prompt` / `unknown`. |

### Import / Export (`src/webmcp/tools/io.ts`)

| Tool | Read | Notes |
|---|---|---|
| `export_my_routes_geojson` | ✓ | Returns a signed GeoJSON FeatureCollection. |
| `import_geojson` | | Restore from a previous export. |

### Bus reports (`src/webmcp/tools/busReports.ts`)

| Tool | Read | Notes |
|---|---|---|
| `list_bus_reports` | ✓ | Observations about specific buses on a route. |
| `report_bus` | | Record a new observation. Signed. |

### Rescue-me (`src/webmcp/tools/rescue.ts`)

| Tool | Read | Notes |
|---|---|---|
| `send_rescue_me` | | Broadcast a panic alert to connected peers. |
| `list_pending_rescues` | ✓ | Unacknowledged alerts received. |
| `list_all_rescues` | ✓ | Every alert in memory. |
| `acknowledge_rescue` | | Locally mark an alert acknowledged. |
| `remove_rescue` | | Drop an alert from memory. |
| `get_rescue_ttl_ms` | ✓ | 5 minutes (post-ack memory TTL). |

### Health (`src/webmcp/tools/health.ts`)

| Tool | Read | Notes |
|---|---|---|
| `get_server_health` | ✓ | Status, last check, attempts. |
| `get_api_base` | ✓ | Configured API base URL (empty = MSW mocks). |

---

## Privacy and security notes

- Every action is gated by the same UI permission model. For
  example, `start_trip` requires the route to be in the local cache
  (fetch it first with `find_routes_nearby`).
- Read-only tools are flagged with `annotations.readOnlyHint: true`
  so agents can call them without explicit user confirmation.
- Destructive tools (`reset_identity`, `regenerate_identity`, etc.)
  are deliberately NOT read-only. Agents should ask the user before
  calling them — the WebMCP spec doesn't enforce this but the
  `destructiveHint` annotation is the standard hook for it.
- Trip sharing, incidents, bus reports, stop-request info and
  proposals are all **signed** (Ed25519) before they leave the
  device. The server only stores what the user explicitly posts.

---

## Running locally

```bash
npm install
npm run dev    # http://localhost:5173
```

Connect a WebMCP-aware agent (Claude desktop, Chrome DevTools MCP,
etc.) to the running tab. The agent will discover the 70 portami
tools via `document.modelContext.listTools()` and can call them
directly.

To verify registration works without an agent:

```bash
# In DevTools console:
document.modelContext.listTools().map(t => t.name)
```

You should see the full catalogue above.

---

## File layout

```
src/webmcp/
├── init.ts                    # Lazy-loads @mcp-b/global if needed
├── register.ts                # Idempotent registerAllTools()
├── schema.ts                  # JSON Schema helpers (object/str/num/int/bool/empty)
├── index.ts                   # Public entry point
└── tools/
    ├── identity.ts            # 7 tools
    ├── routes.ts              # 7 tools
    ├── proposals.ts           # 5 tools
    ├── trips.ts               # 5 tools
    ├── tripShare.ts           # 10 tools
    ├── pairing.ts             # 9 tools
    ├── journey.ts             # 1 tool
    ├── incidents.ts           # 3 tools
    ├── stopAlerts.ts          # 5 tools
    ├── settings.ts            # 4 tools
    ├── geo.ts                 # 2 tools
    ├── io.ts                  # 2 tools
    ├── busReports.ts          # 2 tools
    ├── rescue.ts              # 6 tools
    └── health.ts              # 2 tools
```

Tests live in `tests/webmcp.test.ts` (surface contracts) and
`tests/tripShareController.test.ts` (singleton behaviour).
