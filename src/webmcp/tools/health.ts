// Server health — exposes the existing health store so an agent
// can decide whether to issue requests that hit the network, or
// wait / operate on local-only data.

import type { ModelContextTool, ModelContext } from '@mcp-b/webmcp-types';
import { getHealthSnapshot } from '@/api/health';
import { getApiBase as getClientApiBase } from '@/api/client';
import { registerOneTool } from '../register';
import { empty } from '../schema';

export const healthTools: ModelContextTool[] = [
  {
    name: 'get_server_health',
    title: 'Get server health',
    description:
      'Return the current health snapshot: status (unknown | healthy | degraded | offline), lastCheckedAt, consecutiveFailures, apiBase.',
    inputSchema: empty(),
    annotations: { readOnlyHint: true },
    async execute() {
      return getHealthSnapshot();
    },
  },

  {
    name: 'get_api_base',
    title: 'Get API base URL',
    description:
      'Return the configured API base URL. Empty string means the app is using MSW mocks (dev mode, or testing enabled).',
    inputSchema: empty(),
    annotations: { readOnlyHint: true },
    async execute() {
      return { apiBase: getClientApiBase() };
    },
  },
];

export async function registerHealthTools(mc: ModelContext): Promise<void> {
  for (const tool of healthTools) {
    await registerOneTool(mc, tool);
  }
}
