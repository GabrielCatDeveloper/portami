// ============================================================
// WebMCP initialization.
//
// Wires the W3C Web Model Context Protocol API into the app:
//   - In Chrome 146+ `document.modelContext` exists natively; we
//     use it directly.
//   - Everywhere else we lazy-load `@mcp-b/global`'s polyfill,
//     which also exposes `document.modelContext`. The lazy import
//     keeps the polyfill out of the initial bundle for browsers
//     that don't need it.
//
// Tools registered with `document.modelContext.registerTool(...)`
// appear in any WebMCP-aware agent (Claude, ChatGPT, Gemini,
// Cursor, etc.) that the user connects to this page.
//
// The caller (main.tsx) awaits this Promise before calling
// `registerAllTools` so the polyfill has time to install
// `document.modelContext` before the registrar reads it.
// ============================================================

let initialized = false;

export async function initWebMcp(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (typeof document === 'undefined') return false;
  // `globalThis.isSecureContext` is false on http://localhost with
  // some browsers and true on https. WebMCP requires a secure
  // context — if we're not in one, skip initialization silently.
  if (typeof globalThis !== 'undefined' && globalThis.isSecureContext === false) {
    return false;
  }
  if (initialized) return true;
  if (document.modelContext) {
    // Native browser support (Chrome 146+) — nothing to install.
    initialized = true;
    return true;
  }

  // Lazy-import the polyfill so its ~30 KB doesn't bloat the
  // initial bundle on browsers that already ship native WebMCP.
  // Vite splits the dynamic import into its own chunk.
  try {
    const { initializeWebModelContext } = await import('@mcp-b/global');
    initializeWebModelContext({
      transport: { tabServer: { allowedOrigins: ['*'] } },
      installTestingShim: true,
    });
    initialized = true;
    return true;
  } catch (err) {
    console.warn('[WebMCP] polyfill init failed:', err);
    return false;
  }
}

/** Read-only check: is the bridge installed? */
export function isWebMcpReady(): boolean {
  return initialized;
}
