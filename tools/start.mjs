// Explicit startup keeps local state initialization independent of npm's
// install-time lifecycle hooks, which are disabled for this project.
await import('./init-state.mjs');
await import('./serve.mjs');
