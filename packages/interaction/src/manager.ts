// =============================================================================
// SelDiA — Interaction Manager
// =============================================================================
// Orchestrates zoom/pan, selection, drag-drop, keyboard nav, and accessibility.

import { ZoomPanHandler, type ViewportState } from './zoom-pan.js';
import { SelectionManager, type SelectableItem, type SelectionCallbacks } from './selection.js';
import { DragDropHandler, type DragCallbacks } from './drag-drop.js';

export interface InteractionOptions {
  /** Enable zoom via scroll wheel */
  zoomEnabled: boolean;
  /** Enable pan via drag (middle mouse or Shift+Left) */
  panEnabled: boolean;
  /** Enable click selection */
  selectionEnabled: boolean;
  /** Enable double-click to edit labels */
  dblClickEdit: boolean;
  /** Enable drag & drop repositioning */
  dragEnabled: boolean;
  /** Enable keyboard navigation */
  keyboardEnabled: boolean;
  /** Enable context menu */
  contextMenuEnabled: boolean;
  /** Undo/redo stack size */
  undoStackSize: number;
}

export interface InteractionCallbacks {
  onViewportChange?: (state: ViewportState) => void;
  onSelectionChange?: (selectedIds: string[]) => void;
  onNodeDragStart?: (nodeId: string) => void;
  onNodeDragEnd?: (nodeId: string, x: number, y: number) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  onEdgeDoubleClick?: (edgeId: string) => void;
  onContextMenu?: (itemId: string, itemType: string, x: number, y: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onDelete?: (selectedIds: string[]) => void;
}

const DEFAULT_OPTIONS: InteractionOptions = {
  zoomEnabled: true,
  panEnabled: true,
  selectionEnabled: true,
  dblClickEdit: true,
  dragEnabled: true,
  keyboardEnabled: true,
  contextMenuEnabled: true,
  undoStackSize: 50,
};

export class InteractionManager {
  readonly zoomPan: ZoomPanHandler;
  readonly selection: SelectionManager;
  readonly dragDrop: DragDropHandler;
  readonly options: InteractionOptions;
  private callbacks: InteractionCallbacks;
  private attached = false;
  private container: HTMLElement | null = null;
  private svgGroup: HTMLElement | null = null;

  // Undo/redo stack
  private undoStack: Array<{ type: string; data: any }> = [];
  private redoStack: Array<{ type: string; data: any }> = [];
  private maxUndoSize: number;

  // Keyboard event handler bound reference for cleanup
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(callbacks: InteractionCallbacks = {}, options: Partial<InteractionOptions> = {}) {
    this.callbacks = callbacks;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.maxUndoSize = this.options.undoStackSize;

    // Create sub-handlers
    this.zoomPan = new ZoomPanHandler({
      onViewportChange: (state) => {
        this.callbacks.onViewportChange?.(state);
      },
    });

    this.selection = new SelectionManager({
      onSelectionChange: (ids) => {
        this.callbacks.onSelectionChange?.(ids);
      },
      onDoubleClick: (item) => {
        if (!this.options.dblClickEdit) return;
        if (item.type === 'node') this.callbacks.onNodeDoubleClick?.(item.id);
        if (item.type === 'edge') this.callbacks.onEdgeDoubleClick?.(item.id);
      },
      onContextMenu: (item, x, y) => {
        if (!this.options.contextMenuEnabled) return;
        this.callbacks.onContextMenu?.(item.id, item.type, x, y);
      },
    });

    this.dragDrop = new DragDropHandler({
      onDragStart: (nodeId, x, y) => {
        this.callbacks.onNodeDragStart?.(nodeId);
      },
      onDragMove: (nodeId, x, y, dx, dy) => {
        // Move the SVG element visually
        if (this.svgGroup) {
          const el = this.svgGroup.querySelector(`[data-id="${nodeId}"]`) as HTMLElement;
          if (el) {
            const current = el.getAttribute('transform') || 'translate(0,0)';
            el.setAttribute('transform', `translate(${dx}, ${dy})`);
          }
        }
      },
      onDragEnd: (nodeId, x, y) => {
        this.callbacks.onNodeDragEnd?.(nodeId, x, y);
        this.pushUndo({ type: 'nodeMoved', data: { nodeId, x, y } });
      },
    });
  }

  /**
   * Attach interaction handlers to a container element.
   * The container should have an SVG element inside it.
   */
  attach(container: HTMLElement): void {
    if (this.attached) return;
    this.container = container;
    this.attached = true;

    // Find or create the SVG group for transforms
    const svg = container.querySelector('svg');
    if (svg) {
      this.svgGroup = svg as unknown as HTMLElement;
    }

    // Attach sub-handlers
    if (this.options.zoomEnabled || this.options.panEnabled) {
      this.zoomPan.attach(container);
    }

    if (this.options.selectionEnabled) {
      this.selection.attach(container);
    }

    if (this.options.dragEnabled) {
      this.dragDrop.attach(container);
    }

    if (this.options.keyboardEnabled) {
      this.boundKeyHandler = this.onKeyDown.bind(this);
      document.addEventListener('keydown', this.boundKeyHandler);
    }

    // Set cursor style
    container.style.cursor = 'default';
  }

  /**
   * Detach interaction handlers and clean up.
   */
  detach(): void {
    if (!this.attached) return;

    this.zoomPan.detach();
    this.selection.detach();
    this.dragDrop.detach();

    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler);
      this.boundKeyHandler = null;
    }

    this.container = null;
    this.svgGroup = null;
    this.attached = false;
  }

  /**
   * Set the interactive items (nodes, edges) for selection.
   */
  setItems(items: SelectableItem[]): void {
    this.selection.setItems(items);
  }

  /**
   * Push an action to the undo stack.
   */
  pushUndo(action: { type: string; data: any }): void {
    this.undoStack.push(action);
    if (this.undoStack.length > this.maxUndoSize) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /**
   * Undo the last action.
   */
  undo(): void {
    const action = this.undoStack.pop();
    if (action) {
      this.redoStack.push(action);
      this.callbacks.onUndo?.();
    }
  }

  /**
   * Redo the last undone action.
   */
  redo(): void {
    const action = this.redoStack.pop();
    if (action) {
      this.undoStack.push(action);
      this.callbacks.onRedo?.();
    }
  }

  /**
   * Get zoom/pan state.
   */
  getViewport(): ViewportState {
    return this.zoomPan.getState();
  }

  /**
   * Set zoom/pan state.
   */
  setViewport(state: Partial<ViewportState>): void {
    this.zoomPan.setState(state);
  }

  /**
   * Fit the diagram to its container.
   */
  fitToContainer(containerWidth: number, containerHeight: number, contentWidth: number, contentHeight: number): void {
    this.zoomPan.fitToContainer(containerWidth, containerHeight, contentWidth, contentHeight);
  }

  private onKeyDown(e: KeyboardEvent): void {
    const selectedIds = this.selection.getSelectedIds();

    switch (e.key) {
      case 'Escape':
        this.selection.clear();
        break;
      case 'Delete':
      case 'Backspace':
        if (selectedIds.length > 0 && e.target && this.container?.contains(e.target as Node)) {
          this.callbacks.onDelete?.(selectedIds);
          e.preventDefault();
        }
        break;
      case 'z':
      case 'Z':
        if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
          this.redo();
          e.preventDefault();
        } else if (e.ctrlKey || e.metaKey) {
          this.undo();
          e.preventDefault();
        }
        break;
      case 'a':
      case 'A':
        if (e.ctrlKey || e.metaKey) {
          this.selection.selectAll();
          e.preventDefault();
        }
        break;
    }
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.detach();
  }
}
