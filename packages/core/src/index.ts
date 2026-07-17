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

// Importers — other diagram formats as engine inputs
export type { MermaidImportResult, MermaidImportDiagnostic } from './import/mermaid.js';
export { importMermaid, isMermaidSource } from './import/mermaid.js';

// Exporters — IR back out to other diagram formats
export { exportMermaid, isMermaidExportable } from './export/mermaid.js';

// Config
export type { SelDiAConfig } from './config.js';
export { DEFAULT_CONFIG } from './config.js';
