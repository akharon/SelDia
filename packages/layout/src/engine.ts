// =============================================================================
// SelDiA — Layout Engine Implementation with Dagre
// =============================================================================

import type { DiagramIR, LayoutResult, IRNode, IREdge } from '@seldia/core/ir/types';
import type { Point, Rect } from '@seldia/core/types/common';
import { Direction } from '@seldia/core/types/common';
import type { LayoutEngine, LayoutOptions } from './types.js';
import dagre from 'dagre';

function dirToDagre(d: Direction): string {
  switch (d) {
    case Direction.TOP_TO_BOTTOM: return 'TB';
    case Direction.LEFT_TO_RIGHT: return 'LR';
    case Direction.BOTTOM_TO_TOP: return 'BT';
    case Direction.RIGHT_TO_LEFT: return 'RL';
    default: return 'TB';
  }
}

export class DagreLayoutEngine implements LayoutEngine {
  readonly id = 'dagre';
  readonly name = 'Dagre (Hierarchical)';
  readonly async = false;

  async layoutAsync(ir: DiagramIR, options: Partial<LayoutOptions>): Promise<LayoutResult> {
    return this.layout(ir, options);
  }

  layout(ir: DiagramIR, options: Partial<LayoutOptions>): LayoutResult {
    const opts = { ...defaultOptions, ...options };
    const g = new dagre.graphlib!.Graph({ directed: true, multigraph: false, compound: false });
    g.setGraph({
      rankdir: dirToDagre(opts.direction),
      nodesep: opts.nodeHorizontalSpacing || 80,
      ranksep: opts.rankSpacing || 80,
      edgesep: opts.edgeSpacing || 20,
      marginx: 40,
      marginy: 40,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Add nodes to dagre with their sizes
    for (const n of ir.nodes) {
      const w = Math.max(n.size.width || 100, 60);
      const h = Math.max(n.size.height || 50, 40);
      g.setNode(n.id, { width: w, height: h, original: n });
    }

    // Add edges to dagre
    for (const e of ir.edges) {
      if (g.hasNode(e.sourceId) && g.hasNode(e.targetId)) {
        g.setEdge(e.sourceId, e.targetId, { id: e.id });
      }
    }

    // Run Dagre layout
    dagre.layout(g);

    // Extract positioned nodes
    const nodes = ir.nodes.map((n) => {
      const gn = g.node(n.id);
      if (gn && (gn.x !== undefined) && (gn.y !== undefined)) {
        // Dagre positions at center, convert to top-left
        const w = Math.max(n.size.width || 100, 60);
        const h = Math.max(n.size.height || 50, 40);
        return {
          ...n,
          position: { x: gn.x - w / 2, y: gn.y - h / 2 },
          size: { width: w, height: h },
        };
      }
      // Fallback: grid position for nodes dagre didn't place
      return n;
    });

    // Compute edge waypoints from dagre edge points
    const edges = ir.edges.map((e) => {
      const edgePoints = g.edge(e.sourceId, e.targetId);
      const src = nodes.find(n => n.id === e.sourceId);
      const tgt = nodes.find(n => n.id === e.targetId);
      if (edgePoints && edgePoints.points && edgePoints.points.length >= 2) {
        const wps: Point[] = edgePoints.points.slice(1, -1).map((p: any) => ({ x: p.x, y: p.y }));
        return { ...e, waypoints: wps };
      }
      return { ...e, waypoints: this.fallbackRoute(e, src, tgt) };
    });

    const positioned: DiagramIR = { ...ir, nodes, edges };
    return { diagram: positioned, bounds: this.computeBounds(nodes), warnings: [] };
  }

  private fallbackRoute(edge: IREdge, src?: IRNode, tgt?: IRNode): Point[] {
    if (!src || !tgt) return [];
    const x1 = src.position.x + src.size.width / 2, y1 = src.position.y + src.size.height;
    const x2 = tgt.position.x + tgt.size.width / 2, y2 = tgt.position.y;
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
    const opts = { ...defaultOptions, ...options };
    const count = ir.nodes.length;
    const cols = 4;
    const rows = Math.ceil(count / cols);
    const nodeW = 160, nodeH = 70;
    const gapX = opts.nodeHorizontalSpacing || 80;
    const gapY = opts.rankSpacing || 80;
    return {
      x: 0, y: 0,
      width: cols * (nodeW + gapX) + 100,
      height: rows * (nodeH + gapY) + 100,
    };
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
