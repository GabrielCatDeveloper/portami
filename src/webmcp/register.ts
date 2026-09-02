// ============================================================
// WebMCP tool registration.
//
// Imports every per-domain tool module and registers all of them
// against `document.modelContext`. The polyfill
// (`@mcp-b/global`) installs `document.modelContext` on browsers
// that don't have it natively (Chrome 146+ has it built-in).
//
// `registerAllTools` is idempotent: calling it more than once is a
// no-op so `main.tsx` can call it unconditionally without worrying
// about double-registration.
// ============================================================

import type { ModelContext, ModelContextTool } from '@mcp-b/webmcp-types';

import { registerIdentityTools } from './tools/identity';
import { registerRoutesTools } from './tools/routes';
import { registerProposalsTools } from './tools/proposals';
import { registerTripsTools } from './tools/trips';
import { registerTripShareTools } from './tools/tripShare';
import { registerPairingTools } from './tools/pairing';
import { registerJourneyTools } from './tools/journey';
import { registerIncidentsTools } from './tools/incidents';
import { registerStopAlertsTools } from './tools/stopAlerts';
import { registerSettingsTools } from './tools/settings';
import { registerGeoTools } from './tools/geo';
import { registerIoTools } from './tools/io';
import { registerBusReportsTools } from './tools/busReports';
import { registerRescueTools } from './tools/rescue';
import { registerHealthTools } from './tools/health';

let registered = false;

/**
 * Register every portami tool with the WebMCP bridge.
 *
 * Returns the number of tools registered, or 0 if the bridge isn't
 * installed (e.g. running in an SSR context, or on an insecure
 * origin).
 */
export async function registerAllTools(): Promise<number> {
  if (typeof document === 'undefined') return 0;
  const mc = document.modelContext;
  if (!mc) return 0;
  if (registered) return TOOL_COUNT;
  registered = true;

  const registerers: Array<(c: ModelContext) => Promise<void>> = [
    registerIdentityTools,
    registerRoutesTools,
    registerProposalsTools,
    registerTripsTools,
    registerTripShareTools,
    registerPairingTools,
    registerJourneyTools,
    registerIncidentsTools,
    registerStopAlertsTools,
    registerSettingsTools,
    registerGeoTools,
    registerIoTools,
    registerBusReportsTools,
    registerRescueTools,
    registerHealthTools,
  ];

  for (const r of registerers) {
    try {
      await r(mc);
    } catch (err) {
      // A single failure shouldn't take down the whole registry —
      // the agent can still use whatever did register.
      console.warn('[WebMCP] tool registration failed:', err);
    }
  }

  return TOOL_COUNT;
}

/** Reset for tests. */
export function _resetForTests(): void {
  registered = false;
}

/**
 * Cast helper: `mc.registerTool` is overloaded so the same tool
 * descriptor can satisfy three different overloads (literal-schema,
 * `inputSchema: InputSchema`, or `inputSchema: undefined`). The
 * loose `ModelContextTool` type we use per-module doesn't pick any
 * single overload unambiguously. Casting to `never` (then back to
 * the loose type) sidesteps the overload-matching rules without
 * giving up type-safety on the inner `execute` callback.
 */
export function registerOneTool(
  mc: ModelContext,
  tool: ModelContextTool,
): Promise<void> {
  // The signature we want to call is the one accepting a tool with
  // `inputSchema: InputSchema`. Cast through the call site so the
  // overload picker matches.
  const t = tool as ModelContextTool & { inputSchema: NonNullable<ModelContextTool['inputSchema']> };
  return mc.registerTool(t);
}

/**
 * Total number of tools we attempt to register. The exact count is
 * `identity (7) + routes (7) + proposals (5) + trips (5) + tripShare
 * (10) + pairing (9) + journey (1) + incidents (3) + stopAlerts (5) +
 * settings (4) + geo (2) + io (2) + busReports (2) + rescue (6) +
 * health (2)` = 70 tools. We keep a constant here so the count can
 * be asserted in tests.
 */
export const TOOL_COUNT = 70;
