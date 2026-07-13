// =============================================================================
// @seldia/interaction — Public API
// =============================================================================

// Visual Editing Types
export * from './visual-edit-types.js';

// Source Map & Code Generation Types
export * from './source-map-types.js';

// Source Map Builder
export { buildSourceMap } from './source-map-builder.js';

// Code Generator
export { SelDiACodeGenerator } from './code-generator.js';

// Diff Patcher
export { SelDiADiffPatcher } from './diff-patcher.js';

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

// Collapse / Expand
export { CollapseExpandHandler } from './collapse-expand.js';
export type {
  CollapseExpandOptions,
  CollapseExpandCallbacks,
  CollapsibleGroup,
} from './collapse-expand.js';

// Tooltips
export { TooltipManager } from './tooltips.js';
export type { TooltipOptions, TooltipContent } from './tooltips.js';

// ARIA Accessibility
export { AriaManager } from './aria.js';
export type { AriaOptions, AriaAnnotation, AriaAnnouncement } from './aria.js';
