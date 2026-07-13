// =============================================================================
// SelDiA — Interactive Webview Renderer
// =============================================================================
// Renders a Diagram IR as an interactive SVG in the VS Code webview.
// Uses @seldia/interaction's InteractionManager for zoom/pan, selection,
// drag-drop, and keyboard navigation.

import type { DiagramIR, IRNode, IREdge, IRGroup } from '@seldia/core';
import { InteractionManager, type InteractionOptions, type SelectableItem } from '@seldia/interaction';

export interface RendererCallbacks {
  onNodeDragEnd: (nodeId: string, oldX: number, oldY: number, newX: number, newY: number) => void;
  onNodeDoubleClick: (nodeId: string) => void;
  onEdgeDoubleClick: (edgeId: string) => void;
  onContextMenu: (itemId: string, itemType: string, x: number, y: number) => void;
  onSelectionChange: (selectedIds: string[]) => void;
  onDelete: (selectedIds: string[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  onLabelEdit: (nodeId: string, newLabel: string) => void;
  onResize: (nodeId: string, newWidth: number, newHeight: number) => void;
  onEdgeReroute: (edgeId: string, newSourceId: string, newTargetId: string) => void;
}

export class WebviewRenderer {
  private container: HTMLElement | null = null;
  private interactionManager: InteractionManager | null = null;
  private callbacks: RendererCallbacks;
  private currentIr: DiagramIR | null = null;
  private nodePositions: Map<string, { x: number; y: number }> = new Map();
  private isInteractive: boolean = false;

  constructor(callbacks: RendererCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Render a Diagram IR into the container as interactive SVG.
   */
  render(container: HTMLElement, ir: DiagramIR, svgContent: string, interactive: boolean): void {
    this.container = container;
    this.currentIr = ir;
    this.isInteractive = interactive;

    container.innerHTML = '';

    this.buildPositionMap(ir);

    const wrapper = document.createElement('div');
    wrapper.className = 'seldia-diagram-wrapper';
    wrapper.style.cssText = 'width:100%;height:100%;overflow:hidden;position:relative;';
    wrapper.innerHTML = svgContent;
    container.appendChild(wrapper);

    if (interactive) {
      this.attachInteraction(wrapper);
    }
  }

  /**
   * Update node position after drag.
   */
  updateNodePosition(nodeId: string, x: number, y: number): void {
    if (!this.container) return;
    const svg = this.container.querySelector('svg');
    if (!svg) return;
    const el = svg.querySelector(`[data-id="${nodeId}"]`) as SVGGElement;
    if (el) {
      el.setAttribute('transform', `translate(${x}, ${y})`);
      this.updateEdgePaths(nodeId);
      this.nodePositions.set(nodeId, { x, y });
    }
  }

  private updateEdgePaths(nodeId: string): void {
    if (!this.container || !this.currentIr) return;
    const svg = this.container.querySelector('svg');
    if (!svg) return;

    for (const edge of this.currentIr.edges) {
      if (edge.sourceId === nodeId || edge.targetId === nodeId) {
        const srcNode = this.currentIr.nodes.find(n => n.id === edge.sourceId);
        const tgtNode = this.currentIr.nodes.find(n => n.id === edge.targetId);
        if (!srcNode || !tgtNode) continue;

        const sx = srcNode.position.x + srcNode.size.width / 2;
        const sy = srcNode.position.y + srcNode.size.height;
        const tx = tgtNode.position.x + tgtNode.size.width / 2;
        const ty = tgtNode.position.y;

        const edgeEl = svg.querySelector(`[data-id="${edge.id}"]`) as SVGPathElement;
        const lineEl = edgeEl?.querySelector('line');
        if (lineEl) {
          lineEl.setAttribute('x1', String(sx));
          lineEl.setAttribute('y1', String(sy));
          lineEl.setAttribute('x2', String(tx));
          lineEl.setAttribute('y2', String(ty));
        }
      }
    }
  }

  screenToDiagram(screenX: number, screenY: number): { x: number; y: number } | null {
    if (!this.interactionManager) return null;
    return this.interactionManager.zoomPan.screenToDiagram(screenX, screenY);
  }

  getViewport(): { scale: number; offsetX: number; offsetY: number } | null {
    if (!this.interactionManager) return null;
    return this.interactionManager.getViewport();
  }

  fitToContainer(): void {
    if (!this.interactionManager || !this.currentIr || !this.container) return;
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const bounds = this.currentIr.bounds;
    const bw = bounds ? bounds.width : 800;
    const bh = bounds ? bounds.height : 600;
    this.interactionManager.fitToContainer(cw, ch, bw, bh);
  }

  dispose(): void {
    if (this.interactionManager) {
      this.interactionManager.dispose();
      this.interactionManager = null;
    }
    this.container = null;
    this.currentIr = null;
  }

  // ── Private ──────────────────────────────────────────────────────────

  private buildPositionMap(ir: DiagramIR): void {
    this.nodePositions.clear();
    for (const node of ir.nodes) {
      this.nodePositions.set(node.id, { x: node.position.x, y: node.position.y });
    }
  }

  private attachInteraction(wrapper: HTMLElement): void {
    const callbacks = {
      onNodeDragEnd: (nodeId: string, x: number, y: number) => {
        const pos = this.nodePositions.get(nodeId);
        if (pos && this.interactionManager) {
          const diagramPos = this.interactionManager.zoomPan.screenToDiagram(x, y);
          this.callbacks.onNodeDragEnd(nodeId, pos.x, pos.y, diagramPos.x, diagramPos.y);
        }
      },
      onNodeDoubleClick: (nodeId: string) => this.callbacks.onNodeDoubleClick(nodeId),
      onEdgeDoubleClick: (edgeId: string) => this.callbacks.onEdgeDoubleClick(edgeId),
      onContextMenu: (itemId: string, itemType: string, x: number, y: number) =>
        this.callbacks.onContextMenu(itemId, itemType, x, y),
      onSelectionChange: (selectedIds: string[]) => {
        if (this.container) {
          const svg = this.container.querySelector('svg');
          if (svg) {
            svg.querySelectorAll('.seldia-resize-handle').forEach(h => {
              const nid = h.getAttribute('data-node-id');
              h.setAttribute('opacity', selectedIds.includes(nid || '') ? '1' : '0');
            });
          }
        }
        this.callbacks.onSelectionChange(selectedIds);
      },
      onDelete: (selectedIds: string[]) => this.callbacks.onDelete(selectedIds),
      onUndo: () => this.callbacks.onUndo(),
      onRedo: () => this.callbacks.onRedo(),
    };

    const interactionOptions: Partial<InteractionOptions> = {
      zoomEnabled: true,
      panEnabled: true,
      selectionEnabled: true,
      dblClickEdit: true,
      dragEnabled: true,
      keyboardEnabled: true,
      contextMenuEnabled: true,
      undoStackSize: 50,
    };

    this.interactionManager = new InteractionManager(callbacks, interactionOptions);

    // Build selectable items
    const items: SelectableItem[] = [];
    if (this.currentIr) {
      for (const node of this.currentIr.nodes) {
        items.push({
          id: node.id,
          type: 'node',
          bounds: {
            x: node.position.x,
            y: node.position.y,
            width: node.size.width || 120,
            height: node.size.height || 50,
          },
        });
      }
      for (const edge of this.currentIr.edges) {
        const src = this.currentIr.nodes.find(n => n.id === edge.sourceId);
        const tgt = this.currentIr.nodes.find(n => n.id === edge.targetId);
        if (src && tgt) {
          const minX = Math.min(src.position.x, tgt.position.x) - 10;
          const minY = Math.min(src.position.y, tgt.position.y) - 10;
          items.push({
            id: edge.id,
            type: 'edge',
            bounds: {
              x: minX,
              y: minY,
              width: Math.abs(tgt.position.x - src.position.x) + 20,
              height: Math.abs(tgt.position.y - src.position.y) + 20,
            },
          });
        }
      }
    }
    this.interactionManager.setItems(items);
    this.interactionManager.attach(wrapper);
  }
}
