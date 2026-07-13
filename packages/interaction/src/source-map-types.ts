// =============================================================================
// SelDiA — Source Map Types
// =============================================================================
// Maps between IR elements and their original DSL source locations.
// Used for bidirectional sync between visual editing and DSL code.

import type { ID, SourceLocation, Point, Rect } from '@seldia/core/types/common';

// -----------------------------------------------------------------------------
// Source Map Entry — maps an IR element to its DSL source
// -----------------------------------------------------------------------------

export type SourceMapEntry =
  | NodeSourceMapEntry
  | EdgeSourceMapEntry
  | GroupSourceMapEntry
  | StyleSourceMapEntry
  | LayoutSourceMapEntry;

export interface NodeSourceMapEntry {
  elementType: 'node';
  irId: ID;
  /** Location of the full node declaration in the DSL source */
  declarationLoc: SourceLocation;
  /** Location of the node ID */
  idLoc: SourceLocation;
  /** Location of the node label (string literal) */
  labelLoc?: SourceLocation;
  /** Location of the node shape delimiter */
  shapeLoc: SourceLocation;
  /** Location of the node style block (if present) */
  styleLoc?: SourceLocation;
  /** Location of the node layout hints (if present) */
  layoutLoc?: SourceLocation;
  /** IR data at the time of last sync */
  irSnapshot: {
    position: Point;
    size: { width: number; height: number };
    label: string;
    shape: string;
  };
}

export interface EdgeSourceMapEntry {
  elementType: 'edge';
  irId: ID;
  /** Location of the full edge declaration */
  declarationLoc: SourceLocation;
  /** Location of the source node reference */
  sourceIdLoc: SourceLocation;
  /** Location of the target node reference */
  targetIdLoc: SourceLocation;
  /** Location of the edge label (if present) */
  labelLoc?: SourceLocation;
  /** Location of the edge style block (if present) */
  styleLoc?: SourceLocation;
  /** IR data at the time of last sync */
  irSnapshot: {
    label?: string;
  };
}

export interface GroupSourceMapEntry {
  elementType: 'group';
  irId: ID;
  /** Location of the group declaration opening */
  declarationLoc: SourceLocation;
  /** Location of the group closing brace */
  closingLoc: SourceLocation;
  /** Location of the group label */
  labelLoc?: SourceLocation;
}

export interface StyleSourceMapEntry {
  elementType: 'style';
  /** The node/edge/group IR ID this style belongs to */
  ownerId: ID;
  ownerType: 'node' | 'edge' | 'group';
  /** Location of each style property within the style block */
  properties: Record<string, SourceLocation>;
}

export interface LayoutSourceMapEntry {
  elementType: 'layout';
  /** The node IR ID this layout hint belongs to */
  ownerId: ID;
  /** Location of each layout property */
  properties: Record<string, SourceLocation>;
}

// -----------------------------------------------------------------------------
// Source Map — the full mapping
// -----------------------------------------------------------------------------

export interface SourceMap {
  /** Source file path */
  filePath: string;

  /** The original DSL source text */
  sourceText: string;

  /** Map from IR element ID → source map entry */
  entries: Map<ID, SourceMapEntry>;

  /** Map from source offset → IR element ID (for reverse lookup) */
  offsetToId: Map<number, ID>;

  /** Build timestamp */
  generatedAt: number;
}

// -----------------------------------------------------------------------------
// DSL Code Generator — generates idiomatic DSL from IR changes
// -----------------------------------------------------------------------------

export interface CodeGenerator {
  /**
   * Generate a DSL node declaration string from IR data.
   * Produces idiomatic, human-readable DSL following the conventions
   * of the target diagram type.
   */
  generateNode(params: GenerateNodeParams): string;

  /**
   * Generate a DSL edge declaration string.
   */
  generateEdge(params: GenerateEdgeParams): string;

  /**
   * Generate a DSL group declaration string.
   */
  generateGroup(params: GenerateGroupParams): string;

  /**
   * Generate a DSL style block string.
   */
  generateStyleBlock(style: Record<string, unknown>, indent: number): string;

  /**
   * Generate a layout hints block string.
   */
  generateLayoutHints(position: Point, indent: number): string;

  /**
   * Generate a complete diagram DSL from an IR.
   * Used when creating a new diagram from scratch in visual mode.
   */
  generateDiagram(ir: import('@seldia/core/ir/types').DiagramIR): string;
}

export interface GenerateNodeParams {
  id: string;
  label: string;
  shape: string;
  style?: Record<string, unknown>;
  position?: Point;
  parentId?: string;
  /** Indentation level (number of spaces) */
  indent: number;
  /** Diagram type for syntax conventions */
  diagramType: string;
}

export interface GenerateEdgeParams {
  sourceId: string;
  targetId: string;
  label?: string;
  style?: Record<string, unknown>;
  routing?: string;
  indent: number;
  diagramType: string;
}

export interface GenerateGroupParams {
  id: string;
  label: string;
  childContent: string;
  style?: Record<string, unknown>;
  indent: number;
  collapsible?: boolean;
}

// -----------------------------------------------------------------------------
// Diff Patcher — computes minimal text edits
// -----------------------------------------------------------------------------

export interface DiffPatcher {
  /**
   * Compute the minimal set of text edits to apply a DSL patch.
   * Preserves surrounding formatting and comments.
   *
   * @param sourceText - The current DSL source text
   * @param patches - The desired patches
   * @returns An ordered list of text edits to apply
   */
  computeEdits(sourceText: string, patches: import('./visual-edit-types').DslPatch[]): TextEdit[];
}

export interface TextEdit {
  /** Start offset in the source text */
  offset: number;
  /** Number of characters to delete */
  deleteCount: number;
  /** New text to insert */
  insert: string;
}

// -----------------------------------------------------------------------------
// Bidirectional Sync Controller
// -----------------------------------------------------------------------------

export interface SyncController {
  /** The source map for the current diagram */
  readonly sourceMap: SourceMap;

  /** The code generator */
  readonly codeGenerator: CodeGenerator;

  /** The diff patcher */
  readonly diffPatcher: DiffPatcher;

  /**
   * Handle a visual edit: compute DSL patches, generate code, produce text edits.
   *
   * @param transaction - The edit transaction from visual editing
   * @returns The computed text edits to apply to the DSL source
   */
  visualToSource(transaction: import('./visual-edit-types').EditTransaction): TextEdit[];

  /**
   * Update the source map from a new parse of the DSL source.
   * Called after the DSL source has been manually edited.
   *
   * @param sourceText - The updated DSL source
   * @param ast - The newly parsed AST
   */
  updateFromSource(sourceText: string, ast: import('@seldia/core/ast/nodes').DiagramAST): void;

  /**
   * Check if a visual edit would conflict with a concurrent source edit.
   * Returns the conflicting node/edge IDs.
   */
  detectConflicts(
    visualEdit: import('./visual-edit-types').EditOperation,
    sourceEdits: TextEdit[]
  ): ID[];

  /**
   * Resolve conflicts by preferring one side.
   */
  resolveConflicts(
    conflicts: ID[],
    strategy: 'prefer-visual' | 'prefer-source'
  ): TextEdit[];
}
