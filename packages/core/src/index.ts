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
export * from './plugin/edit-vocabulary.js';

// Engine
export type { CoreEngine, EngineOptions } from './engine.js';
export { createEngine } from './engine.js';

// Importers — other diagram formats as engine inputs
export type { MermaidImportResult, MermaidImportDiagnostic } from './import/mermaid.js';
export { importMermaid, isMermaidSource } from './import/mermaid.js';
export type { PlantUmlImportResult, PlantUmlImportDiagnostic } from './import/plantuml.js';
export { importPlantUml, isPlantUmlSource } from './import/plantuml.js';

// Exporters — IR back out to other diagram formats
export { exportMermaid, isMermaidExportable } from './export/mermaid.js';
export { exportPlantUml, isPlantUmlExportable } from './export/plantuml.js';
export { exportBpmn, isBpmnExportable } from './export/bpmn.js';
export { exportSqlDdl, isSqlDdlExportable } from './export/sql-ddl.js';

// Theming — named palettes + custom color-map override, applied without
// forking any renderer code (see render/design-system.ts).
export type { PaletteOverride } from './render/design-system.js';
export { BUILTIN_PALETTES, resolvePalette } from './render/design-system.js';
export { escapeXml } from './render/escape.js';
export { FLOW_KEYFRAMES_CSS, TRACE_CSS, INTERACTIVE_FLOW_CSS, FLOW_DURATION } from './render/flow-css.js';

// Macro/include — literal file-inclusion preprocessor, expanded before parse.
export { expandIncludes } from './macro/include.js';
export type { IncludeExpansionResult } from './macro/include.js';

// Diagram diff — structural IR comparison for PR review.
export { diffDiagrams } from './diff/diff.js';
export type { DiagramDiff, NodeDiff, EdgeDiff } from './diff/diff.js';

// Config
export type { SelDiAConfig } from './config.js';
export { DEFAULT_CONFIG } from './config.js';

// Layout quality metrics — yardstick for layout work (see layout/metrics.ts).
export type { LayoutMetrics } from './layout/metrics.js';
export { measureLayout } from './layout/metrics.js';

// Circuit schematics (SPICE / KiCad netlists).
export { parseSpice } from './circuit/spice.js';
export { parseKicadNetlist, isKicadNetlist } from './circuit/kicad.js';
export { circuitToIR, MAX_PARTS } from './circuit/model.js';
export type { CircuitModel, CircuitPart } from './circuit/model.js';
export { SYMBOLS, symbolFor, orient } from './circuit/symbols.js';
export type { SymbolDef, SymbolPin } from './circuit/symbols.js';
export { circuitPlugin, parseNetlist, importCircuit } from './diagrams/circuit.js';
export { fenceToSource } from './import/fence.js';
export type { FenceKind, FenceSource } from './import/fence.js';

// PCB board view (render-only KiCad .kicad_pcb).
export { parseKicadPcb, parseSExp, boardBounds } from './pcb/kicad-pcb.js';
export type { Board as PcbBoard } from './pcb/kicad-pcb.js';
export { pcbPlugin, renderBoard, importPcb } from './diagrams/pcb.js';

// Tables with merged cells (`table` fences) + lossy GFM export.
export { tablePlugin, importTable, layoutTable, transformTable } from './diagrams/table.js';
export { parseTableBody, splitPipeRow, isDelimiterLine, unescapeTableCell, escapeTableCell, parseTableNumber, columnName, valueAt, isNumericColumn, parseChartDirective, formatChartDirective, chartColumnRef, TABLE_CHART_KINDS } from './table/model.js';
export type { TableModel, TableCell, TableAlign, TableDiagnostic, TableChartKind, TableChartSpec } from './table/model.js';
export { tableToChartIR } from './table/to-chart.js';
export { chartCategoryOf } from './render/custom-renderers.js';
export { exportTableGfm } from './export/gfm.js';
export { checkDiagramQuality, formatCheckReport, CHECK_KEYS, CHECK_HINTS } from './check.js';
export type { CheckResult } from './check.js';
