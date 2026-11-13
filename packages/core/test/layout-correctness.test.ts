import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/index.js';
import { routeAllEdges } from '../src/render/edge-routing.js';
import { layoutWithDagre } from '../src/layout/engines.js';
import { Direction } from '../src/types/common.js';
import { importMermaid } from '../src/import/mermaid.js';

const engine = createEngine();
function laid(src: string, elk = false): any {
  const ir: any = JSON.parse(JSON.stringify(importMermaid(src).ir));
  if (elk) ir.metadata = { ...ir.metadata, layoutEngine: 'elk' };
  const r: any = engine.layout(ir);
  expect(r.ok).toBe(true);
  return r.value.diagram;
}
const key = (e: any) => e.waypoints.map((p: any) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ');
const inside = (p: any, b: any, m = 1) =>
  p.x > b.position.x + m && p.x < b.position.x + b.size.width - m && p.y > b.position.y + m && p.y < b.position.y + b.size.height - m;

describe('layout correctness (R5)', () => {
  const PAR = 'flowchart TD\n a[A] -->|first| b[B]\n a -->|second| b';
  for (const elk of [false, true]) {
    it(`parallel edges keep distinct routes and labels (${elk ? 'elk' : 'dagre'})`, () => {
      const ir = laid(PAR, elk);
      expect(ir.edges).toHaveLength(2);
      expect(ir.edges.map((e: any) => e.label).sort()).toEqual(['first', 'second']);
      expect(ir.edges.every((e: any) => e.waypoints.length >= 2)).toBe(true);
      expect(key(ir.edges[0])).not.toBe(key(ir.edges[1]));
      const routed = routeAllEdges(ir.edges, ir.nodes);
      const k = (id: string) => routed.get(id)!.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ');
      expect(k(ir.edges[0].id)).not.toBe(k(ir.edges[1].id));
    });
  }

  for (const dir of ['TD', 'LR']) {
    it(`self-loop is a real loop outside the node (${dir})`, () => {
      const src: any = JSON.parse(JSON.stringify(importMermaid(`flowchart ${dir}\n a[A] --> b[B]\n a -->|retry| a`).ir));
      const l = layoutWithDagre(src, { direction: dir === 'TD' ? Direction.TOP_TO_BOTTOM : Direction.LEFT_TO_RIGHT, nodeSpacing: 50, rankSpacing: 50, edgeSpacing: 10 });
      const ir: any = { nodes: l.nodes, edges: l.edges };
      const loopEdge = ir.edges.find((e: any) => e.sourceId === 'a' && e.targetId === 'a');
      const loop = { waypoints: routeAllEdges(ir.edges, ir.nodes).get(loopEdge.id)! };
      const a = ir.nodes.find((n: any) => n.id === 'a');
      expect(loop.waypoints.length).toBeGreaterThanOrEqual(4);
      expect(loop.waypoints.slice(1, -1).some((p: any) => inside(p, a))).toBe(false);
      const far = dir === 'TD'
        ? Math.max(...loop.waypoints.map((p: any) => p.x)) - (a.position.x + a.size.width)
        : Math.max(...loop.waypoints.map((p: any) => p.y)) - (a.position.y + a.size.height);
      expect(far).toBeGreaterThan(10);
    });
  }

  it('an edge routes around a group containing neither endpoint', () => {
    const ir = laid(`flowchart LR
      subgraph G1
        x[X] --> y[Y]
      end
      subgraph G2
        p[P] --> q[Q]
      end
      a[A] --> x
      a --> p
      y --> c[C]
      q --> c`);
    for (const e of ir.edges) {
      const ends = new Set([e.sourceId, e.targetId]);
      for (const g of ir.groups) {
        if ((g.childNodeIds ?? g.nodeIds ?? []).some((id: string) => ends.has(id))) continue;
        expect(e.waypoints.some((p: any) => inside(p, g, 2))).toBe(false);
      }
    }
  });

  it('A* detours around a group that owns neither endpoint, but not around its own', () => {
    const mk = (id: string, x: number, y: number): any => ({ id, label: id, shape: 'rectangle', position: { x, y }, size: { width: 60, height: 40 }, style: {}, ports: [], classList: [], collapsed: false, data: {} });
    const nodes = [mk('a', 0, 100), mk('c', 400, 100), mk('x', 200, 250)];
    const group: any = { id: 'G', label: 'G', childNodeIds: ['x'], childGroupIds: [], position: { x: 150, y: 60 }, size: { width: 160, height: 260 }, style: {}, classList: [], collapsed: false };
    const mkEdge = (id: string, s: string, t: string): any => ({ id, sourceId: s, targetId: t, style: {}, routing: 'orthogonal', bidirectional: false, classList: [], data: {}, waypoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    const edges = [mkEdge('e1', 'a', 'c'), mkEdge('e2', 'a', 'x')];
    const routed = routeAllEdges(edges, nodes, [group]);
    const inG = (p: any) => p.x > 151 && p.x < 309 && p.y > 61 && p.y < 319;
    expect(routed.get('e1')!.some(inG)).toBe(false);
    expect(routed.get('e2')!.some(inG)).toBe(true); // own group stays enterable
  });
});
