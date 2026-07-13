// =============================================================================
// @seldia/core — Public API
// =============================================================================

// Types
export * from './types/common.js';
export * from './types/shapes.js';
export * from './types/style.js';

// IR
export * from './ir/types.js';

// AST
export * from './ast/nodes.js';

// Plugin System
export * from './plugin/types.js';

// Engine
export type { CoreEngine, EngineOptions } from './engine.js';
export { createEngine } from './engine.js';

// Config
export type { SelDiAConfig } from './config.js';
export { DEFAULT_CONFIG } from './config.js';
