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
