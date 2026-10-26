import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine.js';
import { nudgeRoutes, findJumps, edgePathD, postRoute, avoidBands, groupTitleBands, POST_ROUTE_TYPES } from '../src/render/edge-layer.js';
import { applyPortStubs, snapApexEnd } from '../src/render/edge-routing.js';
import type { Point } from '../src/types/common.js';

const P = (x: number, y: number): Point => ({ x, y });

describe('nudgeRoutes', () => {
  it('separates two overlapping horizontal runs and keeps endpoints on their ports', () => {
    const a = [P(0, 0), P(20, 0), P(20, 50), P(120, 50), P(120, 100), P(150, 100)];
    const b = [P(0, 200), P(30, 200), P(30, 50), P(110, 50), P(110, 120), P(150, 120)];
    const out = nudgeRoutes(new Map([['a', a], ['b', b]]));
    const ya = out.get('a')![2].y, yb = out.get('b')![2].y;
    expect(Math.abs(ya - yb)).toBeGreaterThanOrEqual(12);
    expect(out.get('a')![0]).toEqual(a[0]);
    expect(out.get('a')!.at(-1)).toEqual(a.at(-1));
    expect(out.get('b')![0]).toEqual(b[0]);
    expect(out.get('b')!.at(-1)).toEqual(b.at(-1));
  });
  it('leaves runs that overlap by 8px or less alone', () => {
    const a = [P(0, 0), P(10, 0), P(10, 50), P(60, 50), P(60, 90), P(90, 90)];
    const b = [P(0, 200), P(40, 200), P(40, 40), P(68, 40), P(68, 50), P(120, 50), P(120, 80), P(150, 80)];
    const out = nudgeRoutes(new Map([['a', a], ['b', b]]));
    expect(out.get('a')).toEqual(a);
  });
  it('reverts an edge whose nudge would cut into a node', () => {
    const a = [P(0, 0), P(20, 0), P(20, 50), P(120, 50), P(120, 100), P(150, 100)];
    const b = [P(0, 200), P(30, 200), P(30, 50), P(110, 50), P(110, 120), P(150, 120)];
    const node: any = { id: 'n', position: P(50, 52), size: { width: 40, height: 20 } };
    const out = nudgeRoutes(new Map([['a', a], ['b', b]]), [node]);
    const moved = [out.get('a')![2].y, out.get('b')![2].y];
    expect(moved.some((y) => y === 50)).toBe(true);
    expect(out.get('a')!.some((p) => p.y > 52 && p.y < 72 && p.x > 51 && p.x < 89)).toBe(false);
  });
});

describe('findJumps', () => {
  const h = [P(0, 50), P(100, 50)];
  const v = [P(50, 0), P(50, 100)];
  it('puts one hop on the later edge when it crosses an earlier one at a right angle', () => {
    const jumps = findJumps(new Map([['a', v], ['b', h]]));
    expect(jumps.get('b')).toEqual([{ seg: 0, at: 50 }]);
    expect(jumps.has('a')).toBe(false);
  });
  it('skips crossings within 10px of a bend or endpoint', () => {
    const jumps = findJumps(new Map([['a', [P(5, 0), P(5, 100)]], ['b', h]]));
    expect(jumps.size).toBe(0);
  });
  it('postRoute returns routes and jumps; sketch edges get no jumps', () => {
    const r = postRoute({ nodes: [] }, new Map([['a', v], ['b', h]]));
    expect(r.jumps.get('b')?.length).toBe(1);
    expect(postRoute({ nodes: [] }, new Map([['a', v], ['b', h]]), false).jumps.size).toBe(0);
  });
});

describe('edgePathD', () => {
  it('rounds each bend with a quadratic of radius DS.bendRadius, clamped to half the shorter segment', () => {
    const d = edgePathD([P(0, 0), P(100, 0), P(100, 100)]);
    expect(d).toBe('M0,0L94,0Q100,0 100,6L100,100');
    const tight = edgePathD([P(0, 0), P(100, 0), P(100, 8)]);
    expect(tight).toContain('Q100,0 100,4');
  });
  it('draws a semicircular hop at a jump', () => {
    const d = edgePathD([P(0, 50), P(100, 50)], 0, 0, [{ seg: 0, at: 50 }]);
    expect(d).toBe('M0,50L45,50A5,5 0 0 1 55,50L100,50');
  });
});

describe('applyPortStubs', () => {
  it('lengthens a short final stub by sliding the last two bends', () => {
    const out = applyPortStubs([P(0, 0), P(0, 40), P(100, 40), P(100, 100), P(300, 100), P(300, 104)]);
    expect(Math.hypot(out.at(-1)!.x - out.at(-2)!.x, out.at(-1)!.y - out.at(-2)!.y)).toBeGreaterThanOrEqual(12);
  });
});

describe('layer z-order', () => {
  it('emits groups, casings, edge paths, nodes, arrowheads, then labels', () => {
    const r = createEngine().compileSync('fl "T" { a (Start)\n b [Do]\n a -> b: "go" }');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const svg = r.value.svg;
    const at = (s: string) => svg.indexOf(s);
    expect(at('seldia-edge-casings')).toBeGreaterThan(-1);
    expect(at('seldia-edge-casings')).toBeLessThan(at('class="seldia-edge"'));
    expect(at('class="seldia-edge"')).toBeLessThan(at('class="seldia-node"'));
    expect(at('class="seldia-node"')).toBeLessThan(at('seldia-edge-heads'));
    expect(at('seldia-edge-heads')).toBeLessThan(at('seldia-edge-labels'));
    expect(svg).toMatch(/data-seldia-edge-id="[^"]+" data-src="a" data-tgt="b"/);
    expect(svg).toContain('dominant-baseline="central"');
    expect(svg.match(/data-seldia-edge-id=/g)!.length).toBe(1);
  });
});

const node = (id: string, x: number, y: number, w: number, h: number, shape = 'rectangle') =>
  ({ id, label: id, shape, position: { x, y }, size: { width: w, height: h }, style: {}, data: {} }) as any;

describe('avoidBands', () => {
  const band = { x: 100, y: 0, width: 80, height: 20 };
  it('shifts a vertical interior run out of a title band', () => {
    const r = [P(0, -40), P(140, -40), P(140, 60), P(220, 60), P(220, 120)];
    const out = avoidBands(new Map([['e', r]]), [band]).get('e')!;
    expect(out[1].x === 94 || out[1].x === 186).toBe(true);
    expect(out[2].x).toBe(out[1].x);
  });
  it('moves the target port along the top side when the node allows it', () => {
    const tgt = node('t', 100, 40, 300, 40);
    const r = [P(50, -40), P(50, -10), P(140, -10), P(140, 40)];
    const out = avoidBands(new Map([['e', r]]), [band], [tgt]).get('e')!;
    expect(out.at(-1)!.x).toBeGreaterThan(180);
    expect(out.at(-1)!.y).toBe(40);
  });
  it('leaves the run when the port cannot move (narrow node)', () => {
    const tgt = node('t', 120, 40, 40, 40);
    const r = [P(140, -40), P(140, 40)];
    expect(avoidBands(new Map([['e', r]]), [band], [tgt]).get('e')).toEqual(r);
  });
  it('postRoute and groupTitleBands cooperate; allow-list excludes sankey', () => {
    const b = groupTitleBands([{ label: 'Title', position: { x: 0, y: 0 }, style: {} } as any]);
    expect(b).toHaveLength(1);
    expect(POST_ROUTE_TYPES.has('sankey')).toBe(false);
    expect(POST_ROUTE_TYPES.has('flowchart')).toBe(true);
  });
});

describe('snapApexEnd', () => {
  const d = node('d', 100, 100, 100, 60, 'diamond');
  it('puts a vertical arrival on the top apex', () => {
    const out = snapApexEnd([P(60, 20), P(120, 20), P(120, 90)], d, false);
    expect(out.at(-1)).toEqual(P(150, 97));
    expect(out.at(-2)!.x).toBe(150);
  });
  it('keeps fanned arrivals on the slanted face', () => {
    const pts = [P(60, 20), P(120, 20), P(120, 90)];
    expect(snapApexEnd(pts, d, true)).toEqual(pts);
  });
  it('ignores boxes and far-off arrivals', () => {
    const pts = [P(60, 20), P(120, 20), P(120, 90)];
    expect(snapApexEnd(pts, node('r', 100, 100, 100, 60), false)).toEqual(pts);
    expect(snapApexEnd([P(60, 20), P(225, 20), P(225, 95)], d, false).at(-1)!.x).toBe(225);
  });
  it('snaps a horizontal arrival onto the side vertex', () => {
    const out = snapApexEnd([P(0, 60), P(40, 60), P(40, 120), P(90, 120)], d, false);
    expect(out.at(-1)).toEqual(P(97, 130));
  });
});
describe('vertical hops', () => {
  it('records and draws a hop on a vertical later segment, bulging right', () => {
    const a = [P(0, 50), P(200, 50)];
    const b = [P(100, 0), P(100, 100)];
    const jumps = findJumps(new Map([['a', a], ['b', b]]));
    expect(jumps.get('b')).toEqual([{ seg: 0, at: 50, vert: true }]);
    expect(edgePathD(b, 0, 0, jumps.get('b'))).toContain('A5,5 0 0 1 100,55');
  });
});
