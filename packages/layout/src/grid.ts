// =============================================================================
// SelDiA — Grid Layout Engine (Fallback)
// =============================================================================
// Simple grid-based layout that places nodes in a 4-column grid.
// Used as a fallback when Dagre is not available.

import type { DiagramIR, LayoutResult, IRNode, IREdge } from '@seldia/core/ir/types';
import type { Point, Rect } from '@seldia/core/types/common';
import { Direction } from '@seldia/core/types/common';
import type { LayoutEngine, LayoutOptions } from './types.js';

export class GridLayoutEngine implements LayoutEngine {
  readonly id = 'grid';
  readonly name = 'Grid (Simple)';
  readonly async = false;

  async layoutAsync(ir: DiagramIR, options: Partial<LayoutOptions>): Promise<LayoutResult> {
    return this.layout(ir, options);
  }

  layout(ir: DiagramIR, options: Partial<LayoutOptions>): LayoutResult {
    const opts = { ...defaultOptions, ...options };
    const nodes = ir.nodes.map((n, i) => this.positionNode(n, i, opts));
    const edges = ir.edges.map(e => ({ ...e, waypoints: this.routeEdge(e, nodes, opts) }));
    const positioned: DiagramIR = { ...ir, nodes, edges };
    return { diagram: positioned, bounds: this.computeBounds(nodes), warnings: [] };
  }

  private positionNode(node: IRNode, index: number, opts: LayoutOptions): IRNode {
    if (node.position.x !== 0 || node.position.y !== 0) {
      return {
        ...node,
        size: {
          width: Math.max(node.size.width, 80),
          height: Math.max(node.size.height, 40),
        },
      };
    }
    const cols = 4;
    const row = Math.floor(index / cols);
    const col = index % cols;
    const gapX = (opts.nodeHorizontalSpacing || 80) + 140;
    const gapY = (opts.rankSpacing || 80) + 80;
    return {
      ...node,
      position: { x: 60 + col * gapX, y: 60 + row * gapY },
      size: {
        width: Math.max(node.size.width, 120),
        height: Math.max(node.size.height, 50),
      },
    };
  }

  private routeEdge(edge: IREdge, nodes: IRNode[], opts: LayoutOptions): Point[] {
    const src = nodes.find(n => n.id === edge.sourceId);
    const tgt = nodes.find(n => n.id === edge.targetId);
    if (!src || !tgt) return [];
    if (opts.direction === Direction.LEFT_TO_RIGHT) {
      const lx1 = src.position.x + src.size.width;
      const ly1 = src.position.y + src.size.height / 2;
      const lx2 = tgt.position.x;
      const ly2 = tgt.position.y + tgt.size.height / 2;
      return [
        { x: lx1, y: ly1 },
        { x: (lx1 + lx2) / 2, y: (ly1 + ly2) / 2 },
        { x: lx2, y: ly2 },
      ];
    }
    const x1 = src.position.x + src.size.width / 2;
    const y1 = src.position.y + src.size.height;
    const x2 = tgt.position.x + tgt.size.width / 2;
    const y2 = tgt.position.y;
    return [
      { x: x1, y: y1 },
      { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
      { x: x2, y: y2 },
    ];
  }

  private computeBounds(nodes: IRNode[]): Rect {
    if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + n.size.width);
      maxY = Math.max(maxY, n.position.y + n.size.height);
    }
    return { x: minX, y: minY, width: maxX - minX + 40, height: maxY - minY + 40 };
  }

  estimateBounds(ir: DiagramIR, options: Partial<LayoutOptions>): Rect {
    const c = ir.nodes.length;
    const cols = 4;
    const rows = Math.ceil(c / cols);
    return { x: 0, y: 0, width: cols * 220 + 100, height: rows * 140 + 100 };
  }

  incrementalLayout(ir: DiagramIR, _changes: any[], options: Partial<LayoutOptions>): any {
    return this.layout(ir, options);
  }
}

const defaultOptions: LayoutOptions = {
  direction: Direction.TOP_TO_BOTTOM,
  nodeHorizontalSpacing: 80,
  nodeVerticalSpacing: 60,
  rankSpacing: 80,
  edgeSpacing: 20,
  allowOverlap: false,
  fixedPositions: {},
  maxIterations: 500,
  algorithmOptions: {},
};
