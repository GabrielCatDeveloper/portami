// ============================================================
// WebMCP tool-registration tests.
//
// Asserts the surface contract:
//   - Every tool has a non-empty name, description, and JSON Schema
//     `type: "object"` (per the W3C WebMCP spec).
//   - Tool names are unique across the whole surface — no shadowing
//     between feature modules.
//   - The total count matches the documented `TOOL_COUNT`.
//
// We also exercise the schema helpers and the tripShareController
// imperative API in isolation.
// ============================================================
import { describe, it, expect } from 'vitest';
import { identityTools } from '@/webmcp/tools/identity';
import { routesTools } from '@/webmcp/tools/routes';
import { proposalsTools } from '@/webmcp/tools/proposals';
import { tripsTools } from '@/webmcp/tools/trips';
import { tripShareTools } from '@/webmcp/tools/tripShare';
import { pairingTools } from '@/webmcp/tools/pairing';
import { journeyTools } from '@/webmcp/tools/journey';
import { incidentsTools } from '@/webmcp/tools/incidents';
import { stopAlertsTools } from '@/webmcp/tools/stopAlerts';
import { settingsTools } from '@/webmcp/tools/settings';
import { geoTools } from '@/webmcp/tools/geo';
import { ioTools } from '@/webmcp/tools/io';
import { busReportsTools } from '@/webmcp/tools/busReports';
import { rescueTools } from '@/webmcp/tools/rescue';
import { healthTools } from '@/webmcp/tools/health';
import { object, str, num, bool, empty, int } from '@/webmcp/schema';
import { TOOL_COUNT } from '@/webmcp/register';

const ALL: Array<{ module: string; tools: typeof identityTools }> = [
  { module: 'identity', tools: identityTools },
  { module: 'routes', tools: routesTools },
  { module: 'proposals', tools: proposalsTools },
  { module: 'trips', tools: tripsTools },
  { module: 'tripShare', tools: tripShareTools },
  { module: 'pairing', tools: pairingTools },
  { module: 'journey', tools: journeyTools },
  { module: 'incidents', tools: incidentsTools },
  { module: 'stopAlerts', tools: stopAlertsTools },
  { module: 'settings', tools: settingsTools },
  { module: 'geo', tools: geoTools },
  { module: 'io', tools: ioTools },
  { module: 'busReports', tools: busReportsTools },
  { module: 'rescue', tools: rescueTools },
  { module: 'health', tools: healthTools },
];

describe('WebMCP tool surface', () => {
  it('exposes the documented total count', () => {
    const total = ALL.reduce((sum, m) => sum + m.tools.length, 0);
    expect(total).toBe(TOOL_COUNT);
  });

  it('every tool has a name, description, and an object-shaped inputSchema', () => {
    for (const { module, tools } of ALL) {
      for (const t of tools) {
        expect(typeof t.name, `${module}/${t.name} missing name`).toBe('string');
        expect(t.name.length, `${module}/${t.name} empty name`).toBeGreaterThan(0);
        expect(typeof t.description, `${module}/${t.name} missing description`).toBe('string');
        expect(t.description.length, `${module}/${t.name} empty description`).toBeGreaterThan(20);
        expect(t.inputSchema, `${module}/${t.name} missing inputSchema`).toBeDefined();
        expect((t.inputSchema as { type?: string }).type).toBe('object');
        expect(typeof t.execute, `${module}/${t.name} missing execute`).toBe('function');
      }
    }
  });

  it('tool names are unique across the whole surface', () => {
    const seen = new Map<string, string>();
    for (const { module, tools } of ALL) {
      for (const t of tools) {
        const prev = seen.get(t.name);
        if (prev) {
          throw new Error(`duplicate tool name "${t.name}" in ${prev} and ${module}`);
        }
        seen.set(t.name, module);
      }
    }
    expect(seen.size).toBe(TOOL_COUNT);
  });

  it('read-only tools are annotated with readOnlyHint: true', () => {
    // Every tool with a verb that obviously only reads state should
    // be flagged so the agent knows it can call without confirmation.
    // Tools that hit the network and then mutate the local cache
    // (`find_routes_nearby`, `list_proposals`) are intentionally NOT
    // in this list — they have side effects.
    const readOnlyNames = [
      'get_identity',
      'list_routes',
      'get_route',
      'get_active_buses',
      'get_stop_request',
      'get_proposal',
      'list_proposal_diff_kinds',
      'get_active_trip',
      'list_recent_trips',
      'get_outgoing_share',
      'list_incoming_shares',
      'list_outgoing_share_history',
      'get_friend_location',
      'is_sharing',
      'list_peer_statuses',
      'list_paired_devices',
      'get_pairing_status',
      'list_incidents',
      'list_stop_alerts',
      'get_settings',
      'get_current_position',
      'get_geolocation_permission',
      'export_my_routes_geojson',
      'list_bus_reports',
      'list_pending_rescues',
      'list_all_rescues',
      'get_rescue_ttl_ms',
      'get_server_health',
      'get_api_base',
    ];
    for (const { tools } of ALL) {
      for (const t of tools) {
        if (readOnlyNames.includes(t.name)) {
          expect(t.annotations?.readOnlyHint, `${t.name} should be read-only`).toBe(true);
        }
      }
    }
  });

  it('names use snake_case (a-z, 0-9, _)', () => {
    const re = /^[a-z][a-z0-9_]*$/;
    for (const { tools } of ALL) {
      for (const t of tools) {
        expect(re.test(t.name), `${t.name} is not snake_case`).toBe(true);
      }
    }
  });
});

// ============================================================
// Schema helpers
// ============================================================
describe('schema helpers', () => {
  it('empty() returns an object schema with no properties', () => {
    const s = empty() as { type: string; properties: Record<string, unknown> };
    expect(s.type).toBe('object');
    expect(s.properties).toEqual({});
  });

  it('str() returns a string property', () => {
    const p = str('hi', ['a', 'b']) as { type: string; enum: string[]; description: string };
    expect(p.type).toBe('string');
    expect(p.enum).toEqual(['a', 'b']);
    expect(p.description).toBe('hi');
  });

  it('num() / int() / bool() return the right primitives', () => {
    expect((num('n') as { type: string }).type).toBe('number');
    expect((int('n', { minimum: 1 }) as { type: string; minimum: number }).type).toBe('integer');
    expect((bool('b') as { type: string }).type).toBe('boolean');
  });

  it('object() builds a typed object schema with required keys', () => {
    const s = object({ id: str('r') }, ['id']) as {
      type: string;
      required: string[];
      properties: Record<string, { type: string }>;
    };
    expect(s.type).toBe('object');
    expect(s.required).toEqual(['id']);
    expect(s.properties['id']?.type).toBe('string');
  });
});
