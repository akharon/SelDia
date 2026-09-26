// =============================================================================
// @seldia/interaction — Public API
// =============================================================================
// Type-only package: the editing/source-map vocabulary shared with
// vscode-ext's EditSession and webview client. The runtime handlers that used
// to live here (drag/zoom/selection/etc.) were never wired up — vscode-ext's
// webview client implements its own, so they were deleted rather than kept
// as unused duplicates. See docs/next_steps.md §3.2 step 0.

// Visual Editing Types
export * from './visual-edit-types.js';

// Source Map & Code Generation Types
export * from './source-map-types.js';
