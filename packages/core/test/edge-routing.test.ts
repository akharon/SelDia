// =============================================================================
// SelDiA — Edge routing geometry tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import type { IRNode, IREdge } from '../src/ir/types.js';
import {
  centerOf, nodeRect, pointInRect, segmentExit, clipStart, clipEnd,
  orthogonalElbow, routeBetween, computeFans, EDGE_GAP,
} from '../src/render/edge-routing.js';

function node(id: string, x: number, y: number, w = 100, h = 60): IRNode {
  return {
    id, label: id, shape: 'rectangle' as any,
    position: { x, y }, size: { width: w, height: h }, style: {},
    ports: [], classList: [], collapsed: false, data: {},
  };
}
function edge(id: string, sourceId: string, targetId: string): IREdge {
  return {
    id, sourceId, targetId, style: {}, routing: 'orthogonal' as any,
    bidirectional: false, classList: [], data: {},
  };
}

describe('geometry primitives', () => {
  it('centres and inflates a node box', () => {
    const n = node('a', 10, 20);
    expect(centerOf(n)).toEqual({ x: 60, y: 50 });
    expect(nodeRect(n, 5)).toEqual({ x: 5, y: 15, width: 110, height: 70 });
  });

  it('finds where a segment leaves a rect', () => {
    const r = { x: 0, y: 0, width: 100, height: 100 };
    expect(segmentExit({ x: 50, y: 50 }, { x: 200, y: 50 }, r)).toEqual({ x: 100, y: 50 });
    expect(segmentExit({ x: 50, y: 50 }, { x: 50, y: -80 }, r)).toEqual({ x: 50, y: 0 });
    // Never crosses — both points inside.
    expect(segmentExit({ x: 50, y: 50 }, { x: 60, y: 60 }, r)).toBeNull();
  });

  it('clips a polyline onto the border it starts and ends inside', () => {
    const r = { x: 0, y: 0, width: 100, height: 100 };
    expect(clipStart([{ x: 50, y: 50 }, { x: 300, y: 50 }], r)).toEqual([{ x: 100, y: 50 }, { x: 300, y: 50 }]);
    expect(clipEnd([{ x: -300, y: 50 }, { x: 50, y: 50 }], r)).toEqual([{ x: -300, y: 50 }, { x: 0, y: 50 }]);
    // Already outside — untouched.
    const outside = [{ x: 300, y: 50 }, { x: 400, y: 50 }];
    expect(clipStart(outside, r)).toEqual(outside);
  });

  it('bends the elbow on the longer axis, and not at all when aligned', () => {
    expect(orthogonalElbow({ x: 0, y: 0 }, { x: 0, y: 100 })).toHaveLength(2);
    expect(orthogonalElbow({ x: 0, y: 0 }, { x: 100, y: 0 })).toHaveLength(2);
    // Taller than wide: bend at mid-Y, so both end segments are vertical.
    expect(orthogonalElbow({ x: 0, y: 0 }, { x: 40, y: 200 })).toEqual([
      { x: 0, y: 0 }, { x: 0, y: 100 }, { x: 40, y: 100 }, { x: 40, y: 200 },
    ]);
    // Wider than tall: bend at mid-X, so both end segments are horizontal.
    expect(orthogonalElbow({ x: 0, y: 0 }, { x: 200, y: 40 })).toEqual([
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 200, y: 40 },
    ]);
  });
});

describe('routeBetween', () => {
  // The bug this module exists for: the target sits to the SIDE, so the route
  // must land on the target's left border travelling right. Anchoring on the
  // target's top (what the layout engine reports for a TB rank) made the final
  // segment run along the header instead of into it.
  it('lands on the border facing the source, not the one the engine picked', () => {
    const src = node('a', 0, 0);
    const tgt = node('b', 400, 120);
    const engineRoute = [{ x: 50, y: 60 }, { x: 450, y: 120 }]; // ignored for orthogonal
    const pts = routeBetween(engineRoute, true, src, tgt);

    const first = pts[0], last = pts[pts.length - 1];
    expect(first.x).toBeCloseTo(100 + EDGE_GAP); // leaves the source's RIGHT border
    expect(last.x).toBeCloseTo(400 - EDGE_GAP);  // meets the target's LEFT border
    // ...and arrives horizontally, so the arrowhead points into the border.
    expect(pts[pts.length - 2].y).toBeCloseTo(last.y);
  });

  it('never leaves a point inside either node', () => {
    const src = node('a', 0, 0);
    const tgt = node('b', 400, 120);
    const pts = routeBetween([{ x: 50, y: 60 }, { x: 450, y: 120 }], true, src, tgt);
    for (const p of pts) {
      expect(pointInRect(p, nodeRect(src))).toBe(false);
      expect(pointInRect(p, nodeRect(tgt))).toBe(false);
    }
  });

  it('routes a directly-stacked pair straight down, bottom border to top border', () => {
    const src = node('a', 0, 0);
    const tgt = node('b', 0, 200);
    const pts = routeBetween([{ x: 50, y: 60 }, { x: 50, y: 200 }], true, src, tgt);
    expect(pts[0]).toEqual({ x: 50, y: 60 + EDGE_GAP });
    expect(pts[pts.length - 1]).toEqual({ x: 50, y: 200 - EDGE_GAP });
  });

  it('keeps a non-orthogonal engine route but still clips it to the borders', () => {
    const src = node('a', 0, 0);
    const tgt = node('b', 0, 200);
    const curve = [{ x: 50, y: 30 }, { x: 70, y: 130 }, { x: 50, y: 230 }];
    const pts = routeBetween(curve, false, src, tgt);
    expect(pts).toContainEqual({ x: 70, y: 130 }); // the engine's bend survives
    expect(pointInRect(pts[0], nodeRect(src))).toBe(false);
    expect(pointInRect(pts[pts.length - 1], nodeRect(tgt))).toBe(false);
  });
});

describe('computeFans', () => {
  it('gives edges meeting at one node distinct, non-crossing slots', () => {
    // Three sources stacked vertically, all pointing at one target on the right.
    const nodes = new Map([
      ['top', node('top', 0, 0)],
      ['mid', node('mid', 0, 200)],
      ['bot', node('bot', 0, 400)],
      ['t', node('t', 400, 200, 100, 160)],
    ]);
    const edges = [edge('e1', 'bot', 't'), edge('e2', 'top', 't'), edge('e3', 'mid', 't')];
    const fans = computeFans(edges, nodes);

    expect(fans.get('e1')!.tgtCount).toBe(3);
    // Slots are ordered by where the source sits, not by edge declaration
    // order, so the fanned lines stay parallel instead of crossing.
    expect(fans.get('e2')!.tgtIndex).toBe(0); // top-most source → top slot
    expect(fans.get('e3')!.tgtIndex).toBe(1);
    expect(fans.get('e1')!.tgtIndex).toBe(2); // bottom-most source → bottom slot

    // Each edge then lands on a different point of the target's border.
    const ys = edges.map((e) => {
      const pts = routeBetween([], true, nodes.get(e.sourceId), nodes.get('t'), fans.get(e.id));
      return pts[pts.length - 1].y;
    });
    expect(new Set(ys).size).toBe(3);
  });

  it('leaves a lone edge on the border midpoint', () => {
    const nodes = new Map([['a', node('a', 0, 0)], ['b', node('b', 400, 0)]]);
    const fans = computeFans([edge('e1', 'a', 'b')], nodes);
    expect(fans.get('e1')).toEqual({ srcIndex: 0, srcCount: 1, tgtIndex: 0, tgtCount: 1 });
  });
});
