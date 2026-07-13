// =============================================================================
// SelDiA — Visual Edit Types
// =============================================================================
// Types for the visual editing system that enables direct manipulation
// of rendered diagrams (drag-drop, double-click, inline property editing)
// with bidirectional sync to the DSL source code.

import type { ID, Point, Rect } from '@seldia/core/types/common';
import type { NodeStyle, EdgeStyle } from '@seldia/core/types/style';
import type { ShapeType } from '@seldia/core/types/shapes';

// -----------------------------------------------------------------------------
// Edit Operation — the atomic unit of a visual edit
// -----------------------------------------------------------------------------

export type EditOperation =
  | MoveNodeOp
  | ResizeNodeOp
  | EditLabelOp
  | EditStyleOp
  | ChangeShapeOp
  | AddNodeOp
  | DeleteNodeOp
  | AddEdgeOp
  | DeleteEdgeOp
  | RerouteEdgeOp
  | EditEdgeLabelOp
  | ReorderZIndexOp
  | GroupNodesOp
  | UngroupNodesOp;

// -----------------------------------------------------------------------------
// Individual Operation Types
// -----------------------------------------------------------------------------

export interface MoveNodeOp {
  type: 'move-node';
  nodeId: ID;
  oldPosition: Point;
  newPosition: Point;
  /** Whether this was a nudge (arrow key) vs. drag */
  source: 'drag' | 'nudge';
}

export interface ResizeNodeOp {
  type: 'resize-node';
  nodeId: ID;
  oldSize: { width: number; height: number };
  newSize: { width: number; height: number };
  /** Which handle was dragged */
  handle: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export interface EditLabelOp {
  type: 'edit-label';
  nodeId: ID;
  oldLabel: string;
  newLabel: string;
}

export interface EditStyleOp {
  type: 'edit-style';
  nodeId?: ID;
  edgeId?: ID;
  groupId?: ID;
  /** Complete old style (to support undo) */
  oldStyle: Partial<NodeStyle & EdgeStyle>;
  /** Partial new style (only changed properties) */
  stylePatch: Partial<NodeStyle & EdgeStyle>;
}

export interface ChangeShapeOp {
  type: 'change-shape';
  nodeId: ID;
  oldShape: ShapeType;
  newShape: ShapeType;
}

export interface AddNodeOp {
  type: 'add-node';
  /** ID assigned to the new node */
  nodeId: ID;
  /** Position where the node was added (canvas coordinates) */
  position: Point;
  /** Default shape for new nodes */
  shape: ShapeType;
  /** Initial label (editable after placement) */
  label: string;
  /** Parent group ID if added inside a group */
  parentId?: ID;
  /** Source node ID if added as a connected node */
  connectFromId?: ID;
  /** Generated DSL for the new node (for code sync) */
  generatedDsl: string;
}

export interface DeleteNodeOp {
  type: 'delete-node';
  nodeId: ID;
  /** Full node data for undo */
  snapshot: DeletedNodeSnapshot;
  /** IDs of edges that were also deleted (cascade) */
  cascadedEdgeIds: ID[];
}

export interface DeletedNodeSnapshot {
  id: ID;
  label: string;
  shape: ShapeType;
  position: Point;
  size: { width: number; height: number };
  style: Partial<NodeStyle>;
  parentId?: string;
  /** DSL source snippet (for undo reconstruction) */
  dslSource: string;
}

export interface AddEdgeOp {
  type: 'add-edge';
  edgeId: ID;
  sourceId: ID;
  targetId: ID;
  label?: string;
  /** Generated DSL for the new edge */
  generatedDsl: string;
}

export interface DeleteEdgeOp {
  type: 'delete-edge';
  edgeId: ID;
  /** Full edge data for undo */
  snapshot: DeletedEdgeSnapshot;
}

export interface DeletedEdgeSnapshot {
  id: ID;
  sourceId: ID;
  targetId: ID;
  label?: string;
  style: Partial<EdgeStyle>;
  /** DSL source snippet */
  dslSource: string;
}

export interface RerouteEdgeOp {
  type: 'reroute-edge';
  edgeId: ID;
  oldSourceId: ID;
  newSourceId: ID;
  oldTargetId: ID;
  newTargetId: ID;
}

export interface EditEdgeLabelOp {
  type: 'edit-edge-label';
  edgeId: ID;
  oldLabel: string;
  newLabel: string;
}

export interface ReorderZIndexOp {
  type: 'reorder-zindex';
  nodeId?: ID;
  edgeId?: ID;
  /** 'bringToFront' | 'sendToBack' | 'bringForward' | 'sendBackward' */
  direction: 'bringToFront' | 'sendToBack' | 'bringForward' | 'sendBackward';
  oldZIndex: number;
  newZIndex: number;
}

export interface GroupNodesOp {
  type: 'group-nodes';
  groupId: ID;
  nodeIds: ID[];
  groupLabel: string;
  /** Generated DSL for the new group */
  generatedDsl: string;
}

export interface UngroupNodesOp {
  type: 'ungroup-nodes';
  groupId: ID;
  nodeIds: ID[];
  /** DSL snapshot of the group for undo */
  groupDslSnapshot: string;
}

// -----------------------------------------------------------------------------
// Edit Transaction — groups operations for undo/redo
// -----------------------------------------------------------------------------

export interface EditTransaction {
  /** Unique transaction ID */
  id: ID;

  /** Human-readable description (e.g., "Moved 'Payment Service'") */
  description: string;

  /** The operations in this transaction */
  operations: EditOperation[];

  /** Timestamp of the transaction */
  timestamp: number;
}

// -----------------------------------------------------------------------------
// Undo / Redo Manager
// -----------------------------------------------------------------------------

export interface UndoRedoManager {
  /** Push a new transaction onto the undo stack */
  push(transaction: EditTransaction): void;

  /** Undo the last transaction */
  undo(): EditTransaction | null;

  /** Redo the last undone transaction */
  redo(): EditTransaction | null;

  /** Whether there are transactions to undo */
  canUndo(): boolean;

  /** Whether there are transactions to redo */
  canRedo(): boolean;

  /** Get undo stack size */
  undoStackSize(): number;

  /** Get redo stack size */
  redoStackSize(): number;

  /** Clear all history */
  clear(): void;

  /** Maximum stack size */
  maxStackSize: number;
}

// -----------------------------------------------------------------------------
// Visual Edit State Machine
// -----------------------------------------------------------------------------

export enum EditMode {
  /** Default: pan, zoom, select */
  IDLE = 'idle',
  /** A node or edge is selected (shows handles, properties) */
  SELECTED = 'selected',
  /** Actively dragging a node to reposition */
  DRAGGING = 'dragging',
  /** Editing a label inline (text input active) */
  EDITING_LABEL = 'editing-label',
  /** Editing style properties (property panel open) */
  EDITING_STYLE = 'editing-style',
  /** Drawing a new edge (choose source then target) */
  DRAWING_EDGE = 'drawing-edge',
  /** Placing a new node on the canvas */
  PLACING_NODE = 'placing-node',
  /** Resizing a node via corner handle */
  RESIZING = 'resizing',
  /** Marquee selection (rubber-band rect) */
  MARQUEE_SELECTING = 'marquee-selecting',
}

export interface VisualEditState {
  mode: EditMode;
  selectedNodeIds: ID[];
  selectedEdgeIds: ID[];
  /** Node currently being edited (for label/style edit mode) */
  activeNodeId?: ID;
  /** Edge being drawn (source already selected) */
  edgeDrawSourceId?: ID;
  /** Temporary position during draw/place operations */
  cursorPosition?: Point;
}

// -----------------------------------------------------------------------------
// Gesture Recognizer — maps raw input events to edit intents
// -----------------------------------------------------------------------------

export interface GestureRecognizer {
  /**
   * Process a pointer/mouse event and return the corresponding edit intent.
   * Returns null if the event doesn't trigger an edit.
   */
  recognize(
    event: PointerEvent | MouseEvent,
    currentState: VisualEditState,
    hitTestResult: HitTestResult | null
  ): EditIntent | null;
}

export type EditIntent =
  | { type: 'select'; nodeIds: ID[] }
  | { type: 'deselect-all' }
  | { type: 'start-drag'; nodeId: ID; startPoint: Point }
  | { type: 'continue-drag'; nodeId: ID; currentPoint: Point; delta: Point }
  | { type: 'end-drag'; nodeId: ID; finalPoint: Point }
  | { type: 'start-edit-label'; nodeId: ID }
  | { type: 'start-edit-style'; nodeId: ID }
  | { type: 'start-draw-edge'; sourceId: ID }
  | { type: 'complete-draw-edge'; targetId: ID }
  | { type: 'start-place-node'; position: Point }
  | { type: 'start-resize'; nodeId: ID; handle: string; startPoint: Point }
  | { type: 'continue-resize'; nodeId: ID; currentSize: { width: number; height: number } }
  | { type: 'end-resize'; nodeId: ID; finalSize: { width: number; height: number } }
  | { type: 'show-context-menu'; position: Point; targetType: 'node' | 'edge' | 'group' | 'canvas'; targetId?: ID }
  | { type: 'delete-selected' }
  | { type: 'duplicate-selected' }
  | { type: 'nudge'; direction: 'up' | 'down' | 'left' | 'right'; amount: number };

// -----------------------------------------------------------------------------
// Hit Test Result
// -----------------------------------------------------------------------------

export interface HitTestResult {
  /** Type of element hit */
  targetType: 'node' | 'edge' | 'group' | 'canvas';
  /** Element ID (if node/edge/group) */
  targetId?: string;
  /** Exact point of hit (for edge, the closest point on the path) */
  point: Point;
  /** Distance from the hit point to the element (for edge hit tolerance) */
  distance: number;
}

// -----------------------------------------------------------------------------
// Visual Edit Manager — orchestrates the edit pipeline
// -----------------------------------------------------------------------------

export interface VisualEditManager {
  /** Current edit state */
  readonly state: VisualEditState;

  /** Undo/redo manager */
  readonly undoRedo: UndoRedoManager;

  /** Current edit mode */
  readonly mode: EditMode;

  // ---- Mode Transitions ----

  /** Enter a specific edit mode */
  enterMode(mode: EditMode, context?: Record<string, unknown>): void;

  /** Exit the current mode back to IDLE */
  exitMode(): void;

  // ---- Operations ----

  /** Select one or more nodes */
  selectNodes(nodeIds: ID[]): void;

  /** Select an edge */
  selectEdge(edgeId: ID): void;

  /** Deselect all */
  deselectAll(): void;

  /** Move selected nodes by delta */
  moveNodes(nodeIds: ID[], delta: Point): void;

  /** Commit a drag operation (creates undo transaction) */
  commitMove(nodeId: ID, oldPos: Point, newPos: Point): void;

  /** Start editing a node label */
  startEditLabel(nodeId: ID): void;

  /** Commit a label edit */
  commitEditLabel(nodeId: ID, newLabel: string): void;

  /** Delete selected elements */
  deleteSelected(): void;

  /** Add a new node at position */
  addNode(position: Point, shape: ShapeType, connectFromId?: ID): void;

  /** Start drawing an edge from source */
  startDrawEdge(sourceId: ID): void;

  /** Complete drawing an edge to target */
  completeDrawEdge(targetId: ID): void;

  /** Change a node's shape type */
  changeShape(nodeId: ID, newShape: ShapeType): void;

  /** Apply a style patch to a node or edge */
  applyStylePatch(targetId: ID, targetType: 'node' | 'edge', patch: Record<string, unknown>): void;

  /** Group selected nodes */
  groupSelected(label: string): void;

  /** Ungroup a group */
  ungroup(groupId: ID): void;

  // ---- Event Callbacks ----

  /** Called when visual edits produce a transaction */
  onTransaction?: (transaction: EditTransaction) => void;

  /** Called when the DSL source needs to be updated */
  onDslPatchRequired?: (patches: DslPatch[]) => void;

  /** Called when re-render is needed */
  onRerenderRequired?: (affectedElementIds: ID[]) => void;
}

// -----------------------------------------------------------------------------
// DSL Patch — describes a change to the DSL source code
// -----------------------------------------------------------------------------

export interface DslPatch {
  /** Type of patch */
  type: 'insert' | 'delete' | 'replace';
  /** Start offset in the source text */
  startOffset: number;
  /** End offset in the source text */
  endOffset: number;
  /** New text to insert (for insert/replace) */
  newText?: string;
  /** Human-readable description */
  description: string;
  /** The edit operation that generated this patch */
  sourceOperation: EditOperation;
}
