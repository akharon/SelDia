import { describe, it, expect } from 'vitest';
import type { IRNode } from '../src/ir/types.js';
import { clipToShape, shapeInside } from '../src/render/shape-clip.js';
import { clipRouteToNodes, EDGE_GAP } from '../src/render/edge-routing.js';

function node(shape: string, x = 100, y = 100, w = 120, h = 80): IRNode {
  return { id: shape, label: shape, shape: shape as any, position: { x, y }, size: { width: w, height: h },
    style: {}, ports: [], classList: [], collapsed: false, data: {} } as IRNode;
}
const SHAPES = ['rectangle', 'rounded-rectangle', 'diamond', 'circle', 'hexagon', 'parallelogram', 'stadium', 'cylinder', 'actor'];

describe('shape-aware clipping', () => {
  for (const shape of SHAPES) {
    it(`${shape}: route ends on the outline, EDGE_GAP away`, () => {
      const n = node(shape);
      const c = { x: 160, y: 140 };
      for (const from of [{ x: -200, y: 140 }, { x: 160, y: -200 }, { x: 600, y: 500 }, { x: -100, y: 400 }]) {
        const out = clipRouteToNodes([from, c], undefined, n);
        const end = out[out.length - 1];
        expect(shapeInside(n, 0)(end)).toBe(false);
        expect(shapeInside(n, EDGE_GAP + 0.05)(end)).toBe(true);
        expect(shapeInside(n, EDGE_GAP - 0.05)(end)).toBe(false);
      }
    });
  }
  it('diamond tip: horizontal approach stops EDGE_GAP from the tip, not the box', () => {
    const n = node('diamond');
    const p = clipToShape(n, { x: 160, y: 140 }, { x: -50, y: 140 }, EDGE_GAP);
    expect(p.x).toBeCloseTo(100 - EDGE_GAP, 3);
    // a diagonal approach lands well inside the bounding box corner
    const d = clipToShape(n, { x: 160, y: 140 }, { x: 0, y: 0 }, EDGE_GAP);
    expect(d.x).toBeGreaterThan(100);
    expect(d.y).toBeGreaterThan(100);
  });
  it('re-attaches a fan anchor sitting in a diamond corner', () => {
    const n = node('diamond');
    // anchor on the box's top side, 30px left of centre: outside the diamond, route heads up
    const out = clipRouteToNodes([{ x: 130, y: 100 }, { x: 130, y: -100 }, { x: 500, y: -100 }], n, undefined);
    expect(shapeInside(n, 0)(out[0])).toBe(false);
    expect(shapeInside(n, EDGE_GAP + 0.05)(out[0])).toBe(true);
  });
  it('box shapes behave exactly like the old rect clip', () => {
    const n = node('rectangle');
    const out = clipRouteToNodes([{ x: -100, y: 140 }, { x: 160, y: 140 }], undefined, n);
    expect(out[1].x).toBeCloseTo(100 - EDGE_GAP, 6);
  });
});
