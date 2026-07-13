// =============================================================================
// @seldia/interaction — Public API
// =============================================================================

// Visual Editing Types
export * from './visual-edit-types.js';

// Source Map & Code Generation Types
export * from './source-map-types.js';

// Interaction Manager
export { InteractionManager } from './manager.js';
export type { InteractionOptions, InteractionCallbacks } from './manager.js';

// Zoom & Pan
export { ZoomPanHandler } from './zoom-pan.js';
export type { ViewportState, ZoomPanCallbacks } from './zoom-pan.js';

// Selection
export { SelectionManager } from './selection.js';
export type { SelectableItem, SelectionCallbacks } from './selection.js';

// Drag & Drop
export { DragDropHandler } from './drag-drop.js';
export type { DragCallbacks } from './drag-drop.js';
