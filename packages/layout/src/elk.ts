// =============================================================================
// SelDiA — Layout Engine Implementation with ELK (Eclipse Layout Kernel)
// =============================================================================
// elkjs has no synchronous API (it runs the algorithm via a worker/promise
// internally), so this engine only implements `layoutAsync`. Synchronous
// callers (the VS Code Markdown preview's compileSync path) must select
// another engine — see `LayoutEngine.async`.

import type { DiagramIR, LayoutResult, IRNode, IREdge } from '@seldia/core/ir/types';
import type { Point, Rect } from '@seldia/core/types/common';
import { Direction } from '@seldia/core/types/common';
import type { LayoutEngine, LayoutOptions } from './types.js';
import ELK from 'elkjs/lib/elk.bundled.js';

function dirToElk(d: Direction): string {
  switch (d) {
    case Direction.TOP_TO_BOTTOM: return 'DOWN';
    case Direction.LEFT_TO_RIGHT: return 'RIGHT';
    case Direction.BOTTOM_TO_TOP: return 'UP';
    case Direction.RIGHT_TO_LEFT: return 'LEFT';
    default: return 'DOWN';
  }
}

export class ElkLayoutEngine implements LayoutEngine {
  readonly id = 'elk';
  readonly name = 'ELK (Layered)';
  readonly async = true;

  private elk = new ELK();

  layout(_ir: DiagramIR, _options: Partial<LayoutOptions>): LayoutResult {
    throw new Error(
      'ElkLayoutEngine.layout() is unavailable — elkjs has no synchronous API. ' +
      'Use layoutAsync() (available via CoreEngine.compile(), not compileSync()).'
    );
  }

  async layoutAsync(ir: DiagramIR, options: Partial<LayoutOptions>): Promise<LayoutResult> {
    const opts = { ...defaultOptions, ...options };

    const elkGraph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': dirToElk(opts.direction),
        'elk.spacing.nodeNode': String(opts.nodeHorizontalSpacing || 80),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(opts.rankSpacing || 80),
        'elk.spacing.edgeNode': String(opts.edgeSpacing || 20),
      },
      children: ir.nodes.map((n) => ({
        id: n.id,
        width: Math.max(n.size.width || 100, 60),
        height: Math.max(n.size.height || 50, 40),
      })),
      edges: ir.edges
        .filter((e) => ir.nodes.some((n) => n.id === e.sourceId) && ir.nodes.some((n) => n.id === e.targetId))
        .map((e) => ({ id: e.id, sources: [e.sourceId], targets: [e.targetId] })),
    };

    const result = await this.elk.layout(elkGraph as any);

    const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const child of result.children || []) {
      positions.set(child.id!, {
        x: child.x || 0,
        y: child.y || 0,
        width: child.width || 100,
        height: child.height || 50,
      });
    }

    const nodes = ir.nodes.map((n) => {
      const p = positions.get(n.id);
      if (!p) return n;
      return { ...n, position: { x: p.x, y: p.y }, size: { width: p.width, height: p.height } };
    });

    const edgePoints = new Map<string, Point[]>();
    for (const re of result.edges || []) {
      const sections = (re as any).sections as Array<{ startPoint: Point; endPoint: Point; bendPoints?: Point[] }> | undefined;
      if (!sections || !sections.length) continue;
      const s = sections[0];
      edgePoints.set(re.id!, s.bendPoints ? [...s.bendPoints] : []);
    }

    const edges = ir.edges.map((e) => {
      const src = nodes.find((n) => n.id === e.sourceId);
      const tgt = nodes.find((n) => n.id === e.targetId);
      const bends = edgePoints.get(e.id);
      if (bends) return { ...e, waypoints: bends };
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
