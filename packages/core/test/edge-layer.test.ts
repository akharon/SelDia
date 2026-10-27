import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine.js';
import { nudgeRoutes, findJumps, edgePathD, postRoute, avoidBands, unhugRoutes, groupTitleBands, POST_ROUTE_TYPES, fanPorts, simplifyRoutes, capBends } from '../src/render/edge-layer.js';
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
  it('emits groups, edge paths, nodes, arrowheads, then labels', () => {
    const r = createEngine().compileSync('fl "T" { a (Start)\n b [Do]\n a -> b: "go" }');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const svg = r.value.svg;
    const at = (s: string) => svg.indexOf(s);
    expect(svg).not.toContain('seldia-edge-casing');
    expect(svg).toContain('data-halo="1"');
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

describe('unhugRoutes (S4)', () => {
  const node = (id: string, x: number, y: number, w = 100, h = 60) =>
    ({ id, position: { x, y }, size: { width: w, height: h }, shape: 'rectangle' }) as any;
  it('pushes an interior run hugging a node side off by DS.portStub', () => {
    const n = node('n', 100, 100);
    const r = [P(20, 0), P(20, 50), P(203, 50), P(203, 200), P(300, 200)];   // x=203 is 3px right of n (right = 200)
    const out = unhugRoutes(new Map([['e', r]]), [n]).get('e')!;
    expect(out[2].x).toBe(212);
    expect(out[3].x).toBe(212);
    expect(out[0]).toEqual(r[0]);
    expect(out.at(-1)).toEqual(r.at(-1));
  });
  it('grows a stub at a port on the hugged node instead of detaching it', () => {
    const n = node('n', 100, 100), t = node('t', 150, 300);
    const r = [P(203, 120), P(203, 300)];
    const out = unhugRoutes(new Map([['e', r]]), [n, t]).get('e')!;
    expect(out[0]).toEqual(r[0]);
    expect(out[1]).toEqual(P(212, 120));
    expect(out.at(-1)).toEqual(P(212, 300));
  });
  it('leaves clear routes alone and is part of postRoute', () => {
    const n = node('n', 100, 100);
    const clear = [P(300, 0), P(300, 300)];
    expect(unhugRoutes(new Map([['e', clear]]), [n]).get('e')).toBe(clear);
    const hug = [P(20, 0), P(20, 50), P(203, 50), P(203, 200), P(300, 200)];
    const out = postRoute({ nodes: [n] }, new Map([['e', hug]])).routes.get('e')!;
    expect(out.some((q) => q.x === 203)).toBe(false);
  });
});

const box = (id: string, x: number, y: number, w = 100, h = 50): any => ({ id, position: P(x, y), size: { width: w, height: h }, shape: 'rectangle', type: 'default' });

describe('fanPorts order (router-induced crossings)', () => {
  it('puts the edge that turns left on the left port and the one that turns right on the right', () => {
    const n = box('n', 100, 0);
    // Both leave the bottom at x=150 (id order would put 'a' first, which here is the right-turner).
    const a = [P(150, 50), P(150, 80), P(300, 80), P(300, 200)];
    const b = [P(150, 50), P(150, 100), P(20, 100), P(20, 200)];
    const out = fanPorts(new Map([['a', a], ['b', b]]), [n]);
    expect(out.get('b')![0].x).toBeLessThan(out.get('a')![0].x);
  });
  it('among left turners the earlier turn takes the left port, so the later horizontal clears it', () => {
    const n = box('n', 100, 0);
    const near = [P(150, 50), P(150, 90), P(40, 90), P(40, 200)];
    const far = [P(150, 50), P(150, 160), P(10, 160), P(10, 260)];
    const out = fanPorts(new Map([['a-far', far], ['b-near', near]]), [n]);
    expect(out.get('b-near')![0].x).toBeLessThan(out.get('a-far')![0].x);
  });
  it('is deterministic whatever the insertion order', () => {
    const n = box('n', 100, 0);
    const r1 = [P(150, 50), P(150, 80), P(300, 80), P(300, 200)], r2 = [P(150, 50), P(150, 100), P(20, 100), P(20, 200)], r3 = [P(150, 50), P(150, 200)];
    const x = fanPorts(new Map([['a', r1], ['b', r2], ['c', r3]]), [n]);
    const y = fanPorts(new Map([['c', r3], ['b', r2], ['a', r1]]), [n]);
    for (const id of ['a', 'b', 'c']) expect(x.get(id)).toEqual(y.get(id));
  });
});

describe('nudge channel order', () => {
  // Both runs share x=100, y 0..100. 'a' bends right at both ends, 'b' bends left.
  const a = [P(200, 0), P(100, 0), P(100, 100), P(200, 100)];
  const b = [P(0, 0), P(100, 0), P(100, 100), P(0, 100)];
  it('puts the left-bending run on the left track whatever the ids sort to', () => {
    const out = nudgeRoutes(new Map([['a', a], ['b', b]]));
    expect(out.get('b')![1].x).toBeLessThan(out.get('a')![1].x);
    expect(findJumps(out).size).toBe(0);
  });
  it('gives the same tracks when the ids swap', () => {
    const out = nudgeRoutes(new Map([['z', b], ['y', a]]));
    expect(out.get('z')![1].x).toBeLessThan(out.get('y')![1].x);
  });
});

describe('simplifyRoutes', () => {
  it('drops collinear and duplicate points', () => {
    const r = [P(0, 0), P(0, 20), P(0, 50), P(0, 50), P(80, 50), P(80, 90)];
    expect(simplifyRoutes(new Map([['e', r]])).get('e')).toEqual([P(0, 0), P(0, 50), P(80, 50), P(80, 90)]);
  });
  it('straightens a small Z-jog, leaving both ports where they were', () => {
    const r = [P(0, 0), P(0, 50), P(100, 50), P(100, 56), P(200, 56), P(200, 100)];
    const out = simplifyRoutes(new Map([['e', r]])).get('e')!;
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual(r[0]);
    expect(out.at(-1)).toEqual(r.at(-1));
  });
  it('keeps a long detour jog', () => {
    const r = [P(0, 0), P(0, 50), P(100, 50), P(100, 150), P(200, 150), P(200, 200)];
    expect(simplifyRoutes(new Map([['e', r]])).get('e')).toEqual(r);
  });
  it('keeps the jog when removing it would cut into a node', () => {
    const r = [P(0, 0), P(0, 50), P(100, 50), P(100, 56), P(200, 56), P(200, 100)];
    const nodes = [box('n1', 120, 40, 60, 12), box('n2', 20, 54, 60, 8)];
    expect(simplifyRoutes(new Map([['e', r]]), nodes).get('e')).toEqual(r);
  });
  it('keeps the jog when removing it would add a crossing', () => {
    const r = [P(0, 0), P(0, 50), P(100, 50), P(100, 56), P(200, 56), P(200, 100)];
    const wall = [P(20, 53), P(20, 60)]; // vertical wall crossed only by the y=56 line
    const out = simplifyRoutes(new Map([['e', r], ['w', wall]])).get('e')!;
    expect(out.length === 6 || out.every((p) => p.y !== 56 || p.x > 20)).toBe(true);
  });
});

describe('capBends', () => {
  const sixBends = [P(100, 0), P(100, 20), P(40, 20), P(40, 40), P(160, 40), P(160, 60), P(100, 60), P(100, 100)];
  it('retries a route over the cap as a simpler one with the same ports', () => {
    const out = capBends(new Map([['e', sixBends]]), [], 4).get('e')!;
    expect(out.length - 2).toBeLessThan(sixBends.length - 2);
    expect(out[0]).toEqual(sixBends[0]);
    expect(out.at(-1)).toEqual(sixBends.at(-1));
  });
  it('leaves routes within the cap alone', () => {
    const r = [P(0, 0), P(0, 50), P(80, 50), P(80, 90)];
    expect(capBends(new Map([['e', r]]), [], 4).get('e')).toBe(r);
  });
  it('refuses a retry that would hit a node', () => {
    const nodes = [box('n', 90, 25, 20, 10)]; // misses the six-bend route, sits on the direct line
    expect(capBends(new Map([['e', sixBends]]), nodes, 4).get('e')).toBe(sixBends);
  });
});

describe('postRoute determinism', () => {
  it('returns identical routes on repeated runs', () => {
    const n1 = box('n1', 100, 0), n2 = box('n2', 100, 300);
    const routes = () => new Map<string, Point[]>([
      ['a', [P(150, 50), P(150, 80), P(300, 80), P(300, 330), P(200, 330)]],
      ['b', [P(150, 50), P(150, 100), P(20, 100), P(20, 330), P(100, 330)]],
    ]);
    const r1 = postRoute({ nodes: [n1, n2] }, routes()), r2 = postRoute({ nodes: [n1, n2] }, routes());
    expect([...r1.routes]).toEqual([...r2.routes]);
  });
});

describe('capBends end stubs', () => {
  it('never leaves a first or last leg shorter than the minimum stub', () => {
    // Direct Z between the ports would leave a 4px final leg: rejected.
    const r = [P(100, 0), P(100, 20), P(40, 20), P(40, 40), P(160, 40), P(160, 60), P(100, 60), P(100, 64)];
    const out = capBends(new Map([['e', r]]), [], 4).get('e')!;
    const a = out[0], b = out[1], y = out[out.length - 2], z = out[out.length - 1];
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(8);
    expect(Math.abs(y.x - z.x) + Math.abs(y.y - z.y)).toBeGreaterThanOrEqual(8);
  });
});

describe('fanPorts crowded side', () => {
  it('moves a Z-shaped end to the adjacent side when the top is too crowded', () => {
    const n = box('n', 100, 100, 100, 60); // 5 ends on a 100px side are 16.7px apart (< 1.5 stubs)
    const routes = new Map<string, Point[]>();
    for (const [i, x] of [20, 30, 40].entries()) routes.set(`z${i}`, [P(x, 0), P(x, 70), P(130 + i * 20, 70), P(130 + i * 20, 100)]);
    routes.set('s0', [P(150, 0), P(150, 100)]);
    routes.set('s1', [P(180, 0), P(180, 100)]);
    const out = fanPorts(routes, [n]);
    const toLeft = [...out.values()].filter((r) => Math.abs(r[r.length - 1].x - 100) < 1);
    expect(toLeft.length).toBeGreaterThanOrEqual(1);
    for (const r of toLeft) expect(r.length).toBe(3); // one bend fewer than the Z
    // No two ends share a pin on the destination side.
    const ys = toLeft.map((r) => Math.round(r[r.length - 1].y));
    expect(new Set(ys).size).toBe(ys.length);
    // Ends left on the top are spaced at least 1.5 stubs apart.
    const xs = [...out.values()].filter((r) => Math.abs(r[r.length - 1].y - 100) < 1).map((r) => r[r.length - 1].x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(18 - 1e-6);
  });
});

describe('route caches do not alias', () => {
  it('mutating a returned route leaves the next result intact', async () => {
    const { routeAllEdges } = await import('../src/render/edge-routing.js');
    const mk = (id: string, x: number, y: number): any => ({ id, position: P(x, y), size: { width: 100, height: 50 }, shape: 'rectangle', type: 'default' });
    const nodes = [mk('a', 0, 0), mk('b', 200, 200)];
    const edges: any[] = [{ id: 'e', sourceId: 'a', targetId: 'b', routing: 'orthogonal', waypoints: [P(50, 50), P(250, 200)] }];
    const r1 = routeAllEdges(edges, nodes);
    const snap = JSON.stringify(r1.get('e'));
    r1.get('e')![0].x += 999;
    expect(JSON.stringify(routeAllEdges(edges, nodes).get('e'))).toBe(snap);
    const p1 = postRoute({ nodes }, routeAllEdges(edges, nodes));
    const s2 = JSON.stringify(p1.routes.get('e'));
    p1.routes.get('e')![0].y += 999;
    expect(JSON.stringify(postRoute({ nodes }, routeAllEdges(edges, nodes)).routes.get('e'))).toBe(s2);
  });
});
