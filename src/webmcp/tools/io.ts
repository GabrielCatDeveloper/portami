import { registerOneTool } from '../register';
// Import / Export tools — GeoJSON routes signed by the user, plus
// the reverse. Both functions are local-only (no server round-trip);
// the export signs the features with the user's Ed25519 key so the
// import can verify provenance.

import type { ModelContextTool, ModelContext } from '@mcp-b/webmcp-types';
import { exportMyRoutesAsGeoJSON, importGeoJSON, type ImportMode } from '@/io/geojson';
import { object, str } from '../schema';

const IMPORT_MODES = ['replace', 'keep', 'merge'] as const;

export const ioTools: ModelContextTool[] = [
  {
    name: 'export_my_routes_geojson',
    title: 'Export my routes as GeoJSON',
    description:
      'Build a signed GeoJSON FeatureCollection containing all routes the user created + their proposals. Returns the full JSON so the agent can write it to disk or hand it off.',
    inputSchema: object({}),
    annotations: { readOnlyHint: true },
    async execute() {
      return exportMyRoutesAsGeoJSON();
    },
  },

  {
    name: 'import_geojson',
    title: 'Import a GeoJSON export',
    description:
      'Import a previously-exported FeatureCollection. Verifies the signature; if invalid, marks the import as read-only (no edits applied). Use `resolutionsJson` to override the per-route resolution (default: keep if exists, replace otherwise).',
    inputSchema: object({
      geojson: str('The GeoJSON object as a JSON string.'),
      resolutionsJson: str(
        'Optional JSON map of routeId → mode. Mode is one of: replace, keep, merge.',
      ),
    }, ['geojson']),
    async execute({ geojson, resolutionsJson }) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(geojson as string);
      } catch {
        throw new Error('geojson is not valid JSON');
      }
      const resolutions: Record<string, ImportMode> = {};
      if (typeof resolutionsJson === 'string' && resolutionsJson.length > 0) {
        const raw = JSON.parse(resolutionsJson) as Record<string, string>;
        for (const [k, v] of Object.entries(raw)) {
          if ((IMPORT_MODES as readonly string[]).includes(v)) {
            resolutions[k] = v as ImportMode;
          }
        }
      }
      return importGeoJSON(parsed, resolutions);
    },
  },
];

export async function registerIoTools(mc: ModelContext): Promise<void> {
  for (const t of ioTools) await registerOneTool(mc, t);
}
