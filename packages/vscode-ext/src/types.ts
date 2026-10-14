// =============================================================================
// SelDiA VS Code Extension — Core Types
// =============================================================================

import type { ID } from '@seldia/core/types/common';
import type { DiagramIR } from '@seldia/core/ir/types';
import type { Theme } from '@seldia/core/types/style';
import type { EditMode, VisualEditState, DslPatch, UndoRedoManager } from '@seldia/interaction';

// -----------------------------------------------------------------------------
// Markdown Diagram Block — detected in .md files
// -----------------------------------------------------------------------------

export interface MarkdownDiagramBlock {
  /** Unique block ID within the document */
  blockId: ID;

  /** The SelDiA DSL source extracted from the fenced code block */
  dslSource: string;

  /** Start line of the fenced code block in the document (0-based) */
  startLine: number;

  /** End line of the fenced code block (inclusive) */
  endLine: number;

  /** Range of the entire fenced block (including ``` markers) */
  fullRange: {
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
  };

  /** The diagram type (parsed from the block) */
  diagramType: string;

  /** The diagram title (parsed from the block) */
  title?: string;

  /** Whether the diagram is currently in code view (false = diagram view) */
  showCode: boolean;

  /** The compiled Diagram IR (null if parse failed) */
  ir?: DiagramIR;

  /** Parse/compile errors (if any) */
  errors: BlockError[];
}

export interface BlockError {
  message: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
}

// -----------------------------------------------------------------------------
// View Mode — controls the display of a .sld document or markdown block
// -----------------------------------------------------------------------------

export enum DiagramViewMode {
  /** Show only the rendered diagram (DSL source hidden) */
  DIAGRAM = 'diagram',

  /** Show only the DSL source code */
  CODE = 'code',

  /** Show code on the left, rendered diagram on the right */
  SPLIT = 'split',
}

// -----------------------------------------------------------------------------
// Extension State — persisted across VS Code sessions
// -----------------------------------------------------------------------------

export interface ExtensionState {
  /** Current view mode for .sld files */
  fileViewMode: DiagramViewMode;

  /** Current view mode for markdown blocks */
  markdownViewMode: DiagramViewMode;

  /** Active theme ID */
  theme: string;

  /** Whether interactive editing is enabled */
  interactiveEnabled: boolean;

  /** Zoom level for the current diagram */
  zoom: number;

  /** Per-file state: markdown block view modes keyed by block ID */
  blockStates: Record<string, {
    viewMode: DiagramViewMode;
    showCode: boolean;
  }>;
}

// -----------------------------------------------------------------------------
// Webview Message Protocol
// -----------------------------------------------------------------------------

/** Messages sent from the extension host to the webview */
export type ExtToWebviewMessage =
  | ExtMsgRender
  | ExtMsgUpdateTheme
  | ExtMsgUpdateZoom
  | ExtMsgSelectNode
  | ExtMsgHighlightError
  | ExtMsgSetEditMode
  | ExtMsgSyncUndoRedo
  | ExtMsgSyncDirty;

export interface ExtMsgRender {
  type: 'render';
  /** The compiled diagram IR */
  ir: DiagramIR;
  /** Theme ID or full theme object */
  theme: string | Theme;
  /** Whether to enable interactive editing */
  interactive: boolean;
  /** Initial zoom level */
  zoom?: number;
  /** Initial view mode */
  viewMode?: DiagramViewMode;
}

export interface ExtMsgUpdateTheme {
  type: 'updateTheme';
  theme: string | Theme;
}

export interface ExtMsgUpdateZoom {
  type: 'updateZoom';
  scale: number;
}

export interface ExtMsgSelectNode {
  type: 'selectNode';
  nodeId: ID;
}

export interface ExtMsgHighlightError {
  type: 'highlightError';
  nodeId: ID;
  message: string;
  severity: 'error' | 'warning';
}

export interface ExtMsgSetEditMode {
  type: 'setEditMode';
  mode: EditMode;
}

export interface ExtMsgSyncUndoRedo {
  type: 'syncUndoRedo';
  canUndo: boolean;
  canRedo: boolean;
}

/** Unsaved-changes state of the underlying document, so the panel's Save
 *  button can show whether visual edits are still only in memory. */
export interface ExtMsgSyncDirty {
  type: 'syncDirty';
  dirty: boolean;
}

/** Messages sent from the webview to the extension host */
export type WebviewToExtMessage =
  | WebviewMsgReady
  | WebviewMsgNodeDragged
  | WebviewMsgNodeDoubleClicked
  | WebviewMsgEdgeDoubleClicked
  | WebviewMsgLabelEdited
  | WebviewMsgStyleEdited
  | WebviewMsgRequestStyleEdit
  | WebviewMsgShapeChanged
  | WebviewMsgNodeAdded
  | WebviewMsgNodeDeleted
  | WebviewMsgEdgeAdded
  | WebviewMsgEdgeDeleted
  | WebviewMsgEdgeRerouted
  | WebviewMsgExportRequested
  | WebviewMsgUndoRequested
  | WebviewMsgRedoRequested
  | WebviewMsgViewModeChanged
  | WebviewMsgZoomChanged
  | WebviewMsgSaveRequested;

export interface WebviewMsgReady {
  type: 'ready';
}

export interface WebviewMsgNodeDragged {
  type: 'nodeDragged';
  nodeId: ID;
  oldPosition: { x: number; y: number };
  newPosition: { x: number; y: number };
}

export interface WebviewMsgNodeDoubleClicked {
  type: 'nodeDoubleClicked';
  nodeId: ID;
}

export interface WebviewMsgEdgeDoubleClicked {
  type: 'edgeDoubleClicked';
  edgeId: ID;
}

export interface WebviewMsgLabelEdited {
  type: 'labelEdited';
  nodeId?: ID;
  edgeId?: ID;
  oldLabel: string;
  newLabel: string;
}

export interface WebviewMsgStyleEdited {
  type: 'styleEdited';
  nodeId?: ID;
  edgeId?: ID;
  groupId?: ID;
  stylePatch: Record<string, unknown>;
}

/** Webview asks the extension host to run the Edit Style QuickPick flow
 *  (the webview itself has no access to native pickers). */
export interface WebviewMsgRequestStyleEdit {
  type: 'requestStyleEdit';
  nodeId: ID;
}

export interface WebviewMsgShapeChanged {
  type: 'shapeChanged';
  nodeId: ID;
  oldShape: string;
  newShape: string;
}

export interface WebviewMsgNodeAdded {
  type: 'nodeAdded';
  nodeId: ID;
  position: { x: number; y: number };
  shape: string;
  label: string;
  connectFromId?: ID;
  parentId?: ID;
}

export interface WebviewMsgNodeDeleted {
  type: 'nodeDeleted';
  nodeId: ID;
}

export interface WebviewMsgEdgeAdded {
  type: 'edgeAdded';
  edgeId: ID;
  sourceId: ID;
  targetId: ID;
  label?: string;
}

export interface WebviewMsgEdgeDeleted {
  type: 'edgeDeleted';
  edgeId: ID;
}

export interface WebviewMsgEdgeRerouted {
  type: 'edgeRerouted';
  edgeId: ID;
  oldSourceId: ID;
  newSourceId: ID;
  oldTargetId: ID;
  newTargetId: ID;
}

export interface WebviewMsgExportRequested {
  type: 'exportRequested';
  format: 'svg' | 'png' | 'pdf';
}

export interface WebviewMsgUndoRequested {
  type: 'undoRequested';
}

export interface WebviewMsgRedoRequested {
  type: 'redoRequested';
}

export interface WebviewMsgViewModeChanged {
  type: 'viewModeChanged';
  mode: DiagramViewMode;
}

export interface WebviewMsgZoomChanged {
  type: 'zoomChanged';
  scale: number;
}

export interface WebviewMsgSaveRequested {
  type: 'saveRequested';
}

// -----------------------------------------------------------------------------
// CodeLens Provider Types
// -----------------------------------------------------------------------------

export interface DiagramCodeLens {
  /** The code block this lens is attached to */
  blockId: ID;
  /** Line number for the lens */
  line: number;
  /** Current state */
  isRendered: boolean;
  /** The diagram title (for display) */
  title?: string;
}

// -----------------------------------------------------------------------------
// Document Decorator Types
// -----------------------------------------------------------------------------

export interface DiagramDecoration {
  /** The block this decoration applies to */
  blockId: ID;
  /** Range to decorate in the editor */
  range: {
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
  };
  /** The rendered SVG content */
  svgContent: string;
  /** Dimensions for sizing */
  width: number;
  height: number;
}

// -----------------------------------------------------------------------------
// MD-to-PDF Export Command Types
// -----------------------------------------------------------------------------

/** Quick-export: uses defaults, no dialog */
export interface Md2PdfQuickExportParams {
  /** The Markdown file URI to export */
  uri: string;
  /** Output path (optional; defaults to <input>.pdf) */
  outputPath?: string;
}

/** Custom export: opens options dialog first */
export interface Md2PdfCustomExportParams {
  /** The Markdown file URI to export */
  uri: string;
}

/** Re-exported for convenience from md2pdf/types */
export type {
  Md2PdfOptions,
  Md2PdfResult,
  PageFormat,
  PdfMargin,
  PdfMetadata,
} from './md2pdf/types';

