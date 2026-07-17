// =============================================================================
// SelDiA — Visual Edit Handler
// =============================================================================
// Handles visual edit actions from the webview and generates integrated
// edit operations. This is the bridge between visual gestures (drag, double-click,
// right-click) and the source-level changes and undo/redo transactions.

import type { DiagramIR } from '@seldia/core';
import type { CoreEngine } from '@seldia/core';
import { WebviewUndoManager } from './undo-manager.js';
import type {
  EditOperation, EditTransaction, EditMode,
  MoveNodeOp, EditLabelOp, AddNodeOp, DeleteNodeOp,
  AddEdgeOp, DeleteEdgeOp, RerouteEdgeOp, ResizeNodeOp, EditStyleOp,
} from '@seldia/interaction';

export interface EditHandlerCallbacks {
  /** Called when an edit generates a DSL patch that needs to be applied to the editor */
  onDslPatch: (edit: string, oldPosition: number, deleteLength: number) => void;
  /** Called when a node has been dragged to a new position. The handler owns
   *  locating the node's declaration and merging x/y into its attribute
   *  block — see edit/position-patch.ts — because that needs the *current*
   *  document text at apply time, not the stale text captured when the drag
   *  started. */
  onNodeMoved: (nodeId: string, x: number, y: number) => void;
  /** Called when the diagram should be re-rendered after undo/redo */
  onRequestReRender: () => void;
  /** Notify of undo/redo state changes */
  onUndoRedoStateChange: (canUndo: boolean, canRedo: boolean) => void;
}

export class VisualEditHandler {
  private engine: CoreEngine;
  private undoManager: WebviewUndoManager;
  private callbacks: EditHandlerCallbacks;
  private currentIr: DiagramIR | null = null;
  private currentSource: string = '';
  private edgeDrawSourceId: string | null = null;
  private editMode: EditMode = 'idle' as EditMode;

  constructor(engine: CoreEngine, callbacks: EditHandlerCallbacks) {
    this.engine = engine;
    this.callbacks = callbacks;
    this.undoManager = new WebviewUndoManager(50);
  }

  setCurrentSource(source: string, ir: DiagramIR): void {
    this.currentSource = source;
    this.currentIr = ir;
  }

  getUndoManager(): WebviewUndoManager {
    return this.undoManager;
  }

  getEditMode(): EditMode {
    return this.editMode;
  }

  setEditMode(mode: EditMode): void {
    this.editMode = mode;
    if (mode !== 'drawing-edge' as EditMode) {
      this.edgeDrawSourceId = null;
    }
    this.notifyUndoRedoState();
  }

  startEdgeDraw(sourceNodeId: string): void {
    this.edgeDrawSourceId = sourceNodeId;
    this.editMode = 'drawing-edge' as EditMode;
  }

  // ── Edit Action Handlers ─────────────────────────────────────────────

  handleNodeDrag(
    nodeId: string,
    oldX: number, oldY: number,
    newX: number, newY: number
  ): void {
    if (Math.abs(oldX - newX) < 2 && Math.abs(oldY - newY) < 2) return;

    const op: MoveNodeOp = {
      type: 'move-node',
      nodeId,
      oldPosition: { x: oldX, y: oldY },
      newPosition: { x: newX, y: newY },
      source: 'drag',
    };

    const txn: EditTransaction = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      description: `Moved '${nodeId}'`,
      operations: [op],
      timestamp: Date.now(),
    };

    this.undoManager.push(txn);

    // Write the new position back into the node's declaration so it survives
    // the next re-render (see edit/position-patch.ts for the merge logic).
    this.callbacks.onNodeMoved(nodeId, newX, newY);
    this.notifyUndoRedoState();
  }

  handleNodeDoubleClick(nodeId: string): void {
    // Find the node in the IR
    if (!this.currentIr) return;
    const node = this.currentIr.nodes.find(n => n.id === nodeId);
    if (!node) return;

    this.editMode = 'editing-label' as EditMode;

    // Send a message to create an inline editor overlay
    // This is handled on the webview side via contenteditable
  }

  handleEdgeDoubleClick(edgeId: string): void {
    this.editMode = 'editing-label' as EditMode;
  }

  handleLabelEdit(nodeId: string, oldLabel: string, newLabel: string): void {
    if (oldLabel === newLabel) return;

    const op: EditLabelOp = {
      type: 'edit-label',
      nodeId,
      oldLabel,
      newLabel,
    };

    const txn: EditTransaction = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      description: `Edited label of '${nodeId}'`,
      operations: [op],
      timestamp: Date.now(),
    };

    this.undoManager.push(txn);

    // Generate DSL patch — find node declaration line and replace label
    const lines = this.currentSource.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(nodeId + ':') || line.includes(nodeId + ':')) {
        // Replace text between quotes
        const quoteMatch = line.match(/"([^"]*)"/);
        if (quoteMatch) {
          const before = quoteMatch[1];
          const offset = lines.slice(0, i).join('\n').length + 1 + quoteMatch.index! + 1;
          this.callbacks.onDslPatch(newLabel, offset, before.length);
        }
        break;
      }
    }

    this.editMode = 'idle' as EditMode;
    this.notifyUndoRedoState();
  }

  handleNodeAdd(parentId?: string, connectFromId?: string): void {
    if (!this.currentIr) return;
    const nodeCount = this.currentIr.nodes.length;

    const nodeId = `node${nodeCount + 1}`;
    const label = `New Node ${nodeCount + 1}`;
    const x = 100 + (nodeCount * 20) % 400;
    const y = 100 + Math.floor((nodeCount * 20) / 400) * 80;

    const generatedDsl = `    ${nodeId}: [${label}]`;

    const op: AddNodeOp = {
      type: 'add-node',
      nodeId,
      position: { x, y },
      shape: 'rect' as any,
      label,
      parentId,
      connectFromId,
      generatedDsl,
    };

    const operations: EditOperation[] = [op];

    if (connectFromId) {
      const edgeId = `e${nodeCount + 1}`;
      const edgeOp: AddEdgeOp = {
        type: 'add-edge',
        edgeId,
        sourceId: connectFromId,
        targetId: nodeId,
        generatedDsl: `    ${connectFromId} --> ${nodeId}`,
      };
      operations.push(edgeOp);
    }

    const txn: EditTransaction = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      description: `Added node '${nodeId}'${connectFromId ? ` connected to '${connectFromId}'` : ''}`,
      operations,
      timestamp: Date.now(),
    };

    this.undoManager.push(txn);

    // Apply to source: insert before the closing brace of the diagram
    const insertPos = this.currentSource.lastIndexOf('}');
    if (insertPos >= 0) {
      const content = generatedDsl + '\n' + (connectFromId ? `    ${connectFromId} --> ${nodeId}\n` : '');
      this.callbacks.onDslPatch(content, insertPos, 0);
    }

    this.notifyUndoRedoState();
  }

  handleNodeDelete(nodeId: string): void {
    if (!this.currentIr) return;

    // Find cascaded edges
    const cascadedEdgeIds: string[] = [];
    for (const edge of this.currentIr.edges) {
      if (edge.sourceId === nodeId || edge.targetId === nodeId) {
        cascadedEdgeIds.push(edge.id);
      }
    }

    const op: DeleteNodeOp = {
      type: 'delete-node',
      nodeId,
      snapshot: {
        id: nodeId,
        label: '',
        shape: 'rect' as any,
        position: { x: 0, y: 0 },
        size: { width: 120, height: 50 },
        style: {},
        dslSource: '',
      },
      cascadedEdgeIds,
    };

    const operations: EditOperation[] = [op];

    // Add delete-edge ops for cascaded edges
    for (const edgeId of cascadedEdgeIds) {
      operations.push({
        type: 'delete-edge',
        edgeId,
        snapshot: { id: edgeId, sourceId: '', targetId: '', dslSource: '' },
      } as DeleteEdgeOp);
    }

    const txn: EditTransaction = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      description: `Deleted '${nodeId}'${cascadedEdgeIds.length > 0 ? ` and ${cascadedEdgeIds.length} edge(s)` : ''}`,
      operations,
      timestamp: Date.now(),
    };

    this.undoManager.push(txn);

    // Remove the node's line and connected edges from the source
    const lines = this.currentSource.split('\n');
    const linesToRemove: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line: string = lines[i];
      if (line.trim().startsWith(nodeId + ':') || line.trim().startsWith(nodeId + ' ')) {
        linesToRemove.push(i);
      }
      for (const eid of cascadedEdgeIds) {
        if (line.trim().startsWith(eid) || line.includes(` ${eid} `)) {
          linesToRemove.push(i);
        }
      }
    }

    const sortedLines = [...new Set(linesToRemove)].sort((a, b) => b - a);
    for (const lineNum of sortedLines) {
      const offset = lines.slice(0, lineNum).join('\n').length;
      const len = lines[lineNum].length + 1; // +1 for newline
      this.callbacks.onDslPatch('', offset, len);
    }

    this.notifyUndoRedoState();
  }

  handleEdgeDelete(edgeId: string): void {
    if (!this.currentIr) return;

    const op: DeleteEdgeOp = {
      type: 'delete-edge',
      edgeId,
      snapshot: { id: edgeId, sourceId: '', targetId: '', dslSource: '', style: {} },
    };

    const txn: EditTransaction = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      description: `Deleted edge '${edgeId}'`,
      operations: [op],
      timestamp: Date.now(),
    };

    this.undoManager.push(txn);

    // Remove the edge's line from the source
    const lines = this.currentSource.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(edgeId) || lines[i].trim().startsWith(edgeId)) {
        const offset = lines.slice(0, i).join('\n').length;
        const len = lines[i].length + 1;
        this.callbacks.onDslPatch('', offset, len);
        break;
      }
    }

    this.notifyUndoRedoState();
  }

  handleEdgeReroute(edgeId: string, newSourceId: string, newTargetId: string): void {
    if (!this.currentIr) return;

    const edge = this.currentIr.edges.find(e => e.id === edgeId);
    if (!edge) return;

    const op: RerouteEdgeOp = {
      type: 'reroute-edge',
      edgeId,
      oldSourceId: edge.sourceId,
      newSourceId,
      oldTargetId: edge.targetId,
      newTargetId,
    };

    const txn: EditTransaction = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      description: `Rerouted edge '${edgeId}'`,
      operations: [op],
      timestamp: Date.now(),
    };

    this.undoManager.push(txn);

    // Update the edge declaration in the source
    const lines = this.currentSource.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line: string = lines[i];
      if (line.includes(edgeId) || (line.includes(edge.sourceId) && line.includes(edge.targetId) && !line.includes(':'))) {
        const offset = lines.slice(0, i).join('\n').length;
        const len = lines[i].length;
        const oldRef = `${edge.sourceId} --> ${edge.targetId}`;
        const newRef = `${newSourceId} --> ${newTargetId}`;
        const updatedLine = line.replace(oldRef, newRef);
        this.callbacks.onDslPatch(updatedLine, offset, len);
        break;
      }
    }

    this.notifyUndoRedoState();
  }

  handleNodeResize(nodeId: string, oldWidth: number, oldHeight: number, newWidth: number, newHeight: number): void {
    const op: ResizeNodeOp = {
      type: 'resize-node',
      nodeId,
      oldSize: { width: oldWidth, height: oldHeight },
      newSize: { width: newWidth, height: newHeight },
      handle: 'bottom-right',
    };

    const txn: EditTransaction = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      description: `Resized '${nodeId}'`,
      operations: [op],
      timestamp: Date.now(),
    };

    this.undoManager.push(txn);

    // Add minWidth/minHeight to the node's style block
    const stylePatch = `minWidth: ${Math.round(newWidth)}, minHeight: ${Math.round(newHeight)}`;
    this.callbacks.onDslPatch(stylePatch, 0, 0);
    this.notifyUndoRedoState();
  }

  handleStyleEdit(nodeId: string, stylePatch: Record<string, unknown>): void {
    const op: EditStyleOp = {
      type: 'edit-style',
      nodeId,
      oldStyle: {},
      stylePatch,
    };

    const txn: EditTransaction = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      description: `Edited style of '${nodeId}'`,
      operations: [op],
      timestamp: Date.now(),
    };

    this.undoManager.push(txn);

    const styleStr = Object.entries(stylePatch)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v}"` : v}`)
      .join(', ');

    this.callbacks.onDslPatch(`{ ${styleStr} }`, 0, 0);
    this.notifyUndoRedoState();
  }

  // ── Undo/Redo ────────────────────────────────────────────────────────

  undo(): void {
    const txn = this.undoManager.undo();
    if (txn) {
      this.callbacks.onRequestReRender();
    }
    this.notifyUndoRedoState();
  }

  redo(): void {
    const txn = this.undoManager.redo();
    if (txn) {
      this.callbacks.onRequestReRender();
    }
    this.notifyUndoRedoState();
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  private notifyUndoRedoState(): void {
    this.callbacks.onUndoRedoStateChange(this.canUndo(), this.canRedo());
  }

  /**
   * Clear all state.
   */
  reset(): void {
    this.undoManager.clear();
    this.currentIr = null;
    this.currentSource = '';
    this.edgeDrawSourceId = null;
    this.editMode = 'idle' as EditMode;
    this.notifyUndoRedoState();
  }
}
