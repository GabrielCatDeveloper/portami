// ============================================================
// WebMCP — public entry point.
//
// Side-effect-free: importing this module does NOT register tools.
// `main.tsx` calls `initWebMcp()` + `registerAllTools()` once after
// the identity has been initialised. The split is intentional:
//   - `initWebMcp()` installs the polyfill (`document.modelContext`)
//   - `registerAllTools()` registers the tools
// ============================================================

export { initWebMcp, isWebMcpReady } from './init';
export { registerAllTools, TOOL_COUNT } from './register';
