// Settings tools — read/flip the user-facing toggles that live in
// localStorage-backed Zustand stores.
//
// Three stores matter here:
//   - collaborate: GPS-to-server flag (Hito 4+). OFF by default.
//   - testing: MSW + synthetic GPS. Persists.
//   - language: i18n language (es/ca/en). Reload required for some
//     language-dependent strings to refresh everywhere.
//
// The ServerStatusBadge health snapshot is also exposed so the
// agent knows whether the API is reachable before issuing requests.

import type { ModelContextTool, ModelContext } from '@mcp-b/webmcp-types';
import { useCollaborateStore } from '@/state/collaborate';
import { useTestingStore } from '@/state/testing';
import { getStoredLanguage, setStoredLanguage, SUPPORTED_LANGUAGES, type Language } from '@/i18n';
import { getHealthSnapshot } from '@/api/health';
import { registerOneTool } from '../register';
import { empty, object, str } from '../schema';

const LANGS = SUPPORTED_LANGUAGES as readonly string[];

export const settingsTools: ModelContextTool[] = [
  {
    name: 'get_settings',
    title: 'Get settings',
    description:
      'Return current settings: language, collaborate flag, testing mode + GPS source, and server health snapshot.',
    inputSchema: empty(),
    annotations: { readOnlyHint: true },
    async execute() {
      const collab = useCollaborateStore.getState();
      const testing = useTestingStore.getState();
    const health = getHealthSnapshot();
    return {
      language: getStoredLanguage(),
      supportedLanguages: LANGS,
      collaborate: { gpsSharedWithServer: collab.enabled },
      testing: { enabled: testing.enabled, gpsMode: testing.gpsMode },
      server: {
        status: health.status,
        lastCheck: health.lastCheck,
        lastSeenUp: health.lastSeenUp,
        attempts: health.attempts,
      },
    };
  },
  },

  {
    name: 'set_collaborate_enabled',
    title: 'Toggle "GPS to server"',
    description:
      'Enable or disable the "Modo colaborador" flag. When ON, every GPS sample of an active trip is POSTed (signed) to the server. OFF by default — the user must opt in.',
    inputSchema: object({
      enabled: str('"true" to enable, "false" to disable.', ['true', 'false']),
    }, ['enabled']),
    async execute({ enabled }) {
      useCollaborateStore.getState().setEnabled(enabled === 'true');
      return { enabled: enabled === 'true' };
    },
  },

  {
    name: 'set_testing_mode',
    title: 'Toggle testing mode',
    description:
      'Enable or disable testing mode. When ON, MSW intercepts every API call and the GPS source becomes synthetic (unless you also pass gpsMode="real"). Requires page reload for the change to fully take effect.',
    inputSchema: object({
      enabled: str('"true" to enable testing mode.', ['true', 'false']),
      gpsMode: str('GPS source when testing mode is on.', ['simulated', 'real']),
    }),
    async execute({ enabled, gpsMode }) {
      const s = useTestingStore.getState();
      s.setEnabled(enabled === 'true');
      if (gpsMode === 'simulated' || gpsMode === 'real') {
        s.setGpsMode(gpsMode);
      }
      return {
        enabled: enabled === 'true',
        gpsMode: useTestingStore.getState().gpsMode,
        note: 'reload the page for the change to fully apply',
      };
    },
  },

  {
    name: 'set_language',
    title: 'Set UI language',
    description:
      'Change the UI language (es/ca/en). Reload the page for the change to apply everywhere.',
    inputSchema: object({ language: str('Language code.', LANGS) }, ['language']),
    async execute({ language }) {
      if (!LANGS.includes(language as string)) {
        throw new Error(`unsupported language: ${language}`);
      }
      setStoredLanguage(language as Language);
      return { language, note: 'reload the page to apply' };
    },
  },
];

export async function registerSettingsTools(mc: ModelContext): Promise<void> {
  for (const t of settingsTools) await registerOneTool(mc, t);
}
