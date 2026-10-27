import { describe, it, expect, vi } from 'vitest';
import { createEngine } from '../src/engine.js';
import * as engines from '../src/layout/engines.js';

function gen(n: number, fan: number): string {
  let s = 'fl "T" {\n';
  for (let i = 0; i < n; i++) s += `  n${i} [Node ${i}]\n`;
  for (let i = 0; i < n; i++) for (let j = 1; j <= fan; j++) { const t = (i * 7 + j * 13) % n; if (t !== i) s += `  n${i} -> n${t}\n`; }
  return s + '}\n';
}

describe('auto layout limits', () => {
  it('perf guard: 60-node, 3-out-degree flowchart compiles under 5s', async () => {
    const e = createEngine({ config: { layoutEngineByType: { flowchart: 'auto' } } } as any);
    const t = Date.now();
    await e.compile(gen(60, 3));
    expect(Date.now() - t).toBeLessThan(5000);
  }, 30000);

  it('autoMaxEdges: above the cap auto runs a single ELK layout', async () => {
    const spy = vi.spyOn(engines, 'layoutWithElkSync');
    const mk = (maxEdges: number) => createEngine({ config: { autoMaxEdges: maxEdges, layoutEngineByType: { flowchart: 'auto' } } } as any);
    spy.mockClear();
    await mk(5).compile(gen(10, 3));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await mk(500).compile(gen(10, 3));
    expect(spy.mock.calls.length).toBeGreaterThan(1); // variants
    spy.mockRestore();
  }, 30000);

  it('medium diagrams try one ELK variant, small ones several', async () => {
    const spy = vi.spyOn(engines, 'layoutWithElkSync');
    spy.mockClear();
    await createEngine({ config: { autoVariantMaxNodes: 2, layoutEngineByType: { flowchart: 'auto' } } } as any).compile(gen(10, 2));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  }, 30000);
});

describe('swapNeighbours', () => {
  it('never worsens crossings/bends and is deterministic', async () => {
    const { swapNeighbours, fullScore } = await import('../src/layout/refine.js');
    const e = createEngine({ config: { layoutEngineByType: { flowchart: 'dagre' } } } as any);
    const p = e.parse(gen(8, 2)); const a = e.analyze((p as any).value); const ir = (e.transform((a as any).value) as any).value;
    const lay = ((await e.layoutAsync(ir)) as any).value.diagram;
    const base = { nodes: lay.nodes, edges: lay.edges };
    const r1 = swapNeighbours(ir, base, true), r2 = swapNeighbours(ir, base, true);
    expect(r1.nodes.map((n: any) => n.position)).toEqual(r2.nodes.map((n: any) => n.position));
    const s0 = fullScore({ ...ir, ...base, groups: [] }, true), s1 = fullScore({ ...ir, ...r1, groups: [] }, true);
    expect(s1[0]).toBeLessThanOrEqual(s0[0]);
    expect(s1[1] <= s0[1]).toBe(true);
  });
});

describe('sweepOrder', () => {
  const setup = async () => {
    const e = createEngine({ config: { layoutEngineByType: { flowchart: 'dagre' } } } as any);
    const src = 'fl "T" {\n a [A]\n b [B]\n c [C]\n d [D]\n a -> d\n b -> c\n a -> c\n}\n';
    const p = e.parse(src); const an = e.analyze((p as any).value); const ir = (e.transform((an as any).value) as any).value;
    const lay = ((await e.layoutAsync(ir)) as any).value.diagram;
    const at: Record<string, [number, number]> = { a: [0, 0], b: [300, 0], c: [0, 200], d: [300, 200] };
    const nodes = lay.nodes.map((n: any) => ({ ...n, size: { width: 100, height: 40 }, position: { x: at[n.id.split('.').pop()!]?.[0] ?? 0, y: at[n.id.split('.').pop()!]?.[1] ?? 0 } }));
    const edges = lay.edges.map((x: any) => ({ ...x, layoutRouted: false, waypoints: [] }));
    return { ir, base: { nodes, edges } };
  };
  it('removes a crossing by reordering a rank, keeping rank slots', async () => {
    const { sweepOrder, fullScore } = await import('../src/layout/refine.js');
    const { ir, base } = await setup();
    const s0 = fullScore({ ...ir, ...base, groups: [] }, true);
    const r = sweepOrder(ir, base, true);
    const s1 = fullScore({ ...ir, ...r, groups: [] }, true);
    expect(s1[0]).toBeLessThanOrEqual(s0[0]);
    expect(s1[1]).toBeLessThanOrEqual(s0[1]);
    for (const y of [0, 200]) {
      const xs = (l: any) => l.nodes.filter((n: any) => n.position.y === y).map((n: any) => n.position.x).sort((a: number, b: number) => a - b);
      expect(xs(r)).toEqual(xs(base));
    }
  });
  it('is deterministic and a no-op on groups', async () => {
    const { sweepOrder } = await import('../src/layout/refine.js');
    const { ir, base } = await setup();
    const a = sweepOrder(ir, base, true), b = sweepOrder(ir, base, true);
    expect(a.nodes.map((n: any) => n.position)).toEqual(b.nodes.map((n: any) => n.position));
    expect(sweepOrder({ ...ir, groups: [{ id: 'g' } as any] }, base, true)).toBe(base);
  });
});

describe('score weighting', () => {
  it('one crossing outweighs up to crossingBendWeight - 1 bends; over-cap bends are a defect', async () => {
    const { DS } = await import('../src/render/design-system.js');
    expect(DS.crossingBendWeight).toBe(8);
    const { fullScore, lexLess } = await import('../src/layout/refine.js');
    const e = createEngine({ config: { layoutEngineByType: { flowchart: 'dagre' } } } as any);
    const p = e.parse(gen(6, 2)); const a = e.analyze((p as any).value); const ir = (e.transform((a as any).value) as any).value;
    const lay = ((await e.layoutAsync(ir)) as any).value.diagram;
    const s = fullScore({ ...ir, nodes: lay.nodes, edges: lay.edges, groups: [] }, true);
    expect(s.length).toBe(4);
    expect(lexLess([0, 1 * DS.crossingBendWeight + 0], [0, 0 * DS.crossingBendWeight + 7])).toBe(false);
    expect(lexLess([0, 0 * DS.crossingBendWeight + 7], [0, 1 * DS.crossingBendWeight + 0])).toBe(true);
  });
});
