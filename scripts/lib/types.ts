// Re-export from the React app's types so the pipeline and the UI stay in sync.
// (We can't easily import across the project root with two separate tsconfigs,
// so we keep a parallel copy in src/lib/types.ts. Edit both together.)

export * from '../../src/lib/types.js';
