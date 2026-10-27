import { describe, it, expect } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { createEngine } from '../src/index.js';
import { importMermaid } from '../src/import/mermaid.js';
import { layoutSync, layoutAsync } from '../src/layout/elk-sync.js';

const graph = () => ({
  id: 'root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.edgeRouting': 'ORTHOGONAL' },
  children: [{ id: 'a', width: 50, height: 30 }, { id: 'b', width: 50, height: 30 }, { id: 'c', width: 50, height: 30 }],
  edges: [{ id: 'e1', sources: ['a'], targets: ['b'] }, { id: 'e2', sources: ['a'], targets: ['c'] }],
});

const SRC = `flowchart TD
  user[User] -->|calls| api
  subgraph Backend
    api[API] --> db[DB]
  end
`;
const IR = (_e: any, src = SRC) => { const r = importMermaid(src); expect(r.ir).toBeDefined(); return JSON.parse(JSON.stringify(r.ir)); };
const withElk = (ir: any) => ({ ...ir, metadata: { ...ir.metadata, layoutEngine: 'elk' } });

describe('elk-sync', () => {
  it('sync output equals the async elkjs output', async () => {
    const s = layoutSync(graph());
    const a: any = await new (ELK as any)().layout(graph());
    expect(JSON.parse(JSON.stringify(s.children))).toEqual(JSON.parse(JSON.stringify(a.children)));
    expect(s.edges[1].sections[0].endPoint).toEqual(a.edges[1].sections[0].endPoint);
    expect((await layoutAsync(graph())).children).toBeDefined();
  });
});

describe('ELK pipeline', () => {
  it('lays out synchronously, routes edges and keeps compound bounds', () => {
    const e = createEngine();
    const r = e.layout(withElk(IR(e)));
    expect(r.ok).toBe(true);
    const d = (r as any).value.diagram;
    expect(d.edges.every((x: any) => x.layoutRouted && x.waypoints.length >= 2)).toBe(true);
    const g = d.groups[0];
    for (const id of ['api', 'db']) {
      const n = d.nodes.find((x: any) => x.id === id);
      expect(n.position.x).toBeGreaterThanOrEqual(g.position.x);
      expect(n.position.y).toBeGreaterThan(g.position.y + 20); // header band
      expect(n.position.x + n.size.width).toBeLessThanOrEqual(g.position.x + g.size.width);
    }
    const user = d.nodes.find((x: any) => x.id === 'user');
    const inside = user.position.x < g.position.x + g.size.width && user.position.x + user.size.width > g.position.x
      && user.position.y < g.position.y + g.size.height && user.position.y + user.size.height > g.position.y;
    expect(inside).toBe(false);
    expect(d.edges.find((x: any) => x.label).layoutLabel).toBeDefined();
  });

  it('defaults stay dagre; per-type config switches engines', () => {
    const noLayout = 'flowchart TD\n  a[A] --> b[B]\n  b --> c[C]\n'; // ungrouped: grouped diagrams now default to elk
    const e = createEngine();
    expect((e.layout(IR(e, noLayout)) as any).value.diagram.edges.some((x: any) => x.layoutRouted)).toBe(false);
    const e2 = createEngine({ config: { layoutEngineByType: { flowchart: 'elk' } } });
    expect((e2.layout(IR(e2, noLayout)) as any).value.diagram.edges.every((x: any) => x.layoutRouted)).toBe(true);
  });

  it('custom-layout types never go through ELK', () => {
    const e = createEngine({ config: { defaultLayoutEngine: 'elk' } });
    const ir = IR(e); ir.type = 'sequence';
    const l: any = e.layout(withElk(ir));
    expect(l.value.diagram.edges.some((x: any) => x.layoutRouted)).toBe(false);
  });

  it('manual layout uses the same engine without crashing, edges unflagged', () => {
    const e = createEngine();
    const ir = withElk(IR(e));
    ir.nodes[0].style = { ...ir.nodes[0].style, x: 10, y: 10 };
    const r = e.layout(ir);
    expect(r.ok).toBe(true);
    expect((r as any).value.diagram.edges.some((x: any) => x.layoutRouted)).toBe(false);
  });

  it('renders ELK-routed output', () => {
    const e = createEngine();
    const r = e.compileIRSync(withElk(IR(e)));
    expect(r.ok).toBe(true);
  });
});

describe('grouped flowcharts default to elk', () => {
  const posOf = (r: any) => JSON.stringify(r.value.diagram.nodes.map((n: any) => [n.id, n.position]));

  it('a grouped flowchart with no layout line lays out with elk', async () => {
    const ir = IR(null);
    const def = await createEngine({}).layoutAsync(ir);
    const dagre = await createEngine({ config: { elkWhenGrouped: false } }).layoutAsync(ir);
    const elk = await createEngine({ config: { layoutEngineByType: { flowchart: 'elk' } } }).layoutAsync(ir);
    expect(posOf(def)).toEqual(posOf(elk));
    expect(posOf(def)).not.toEqual(posOf(dagre));
  });

  it('an ungrouped flowchart with no layout line stays on dagre', async () => {
    const ir = IR(null, 'flowchart TD\n  a[A] --> b[B]\n  b --> c[C]\n');
    const def = await createEngine({}).layoutAsync(ir);
    const dagre = await createEngine({ config: { elkWhenGrouped: false } }).layoutAsync(ir);
    expect(posOf(def)).toEqual(posOf(dagre));
  });
});

describe('auto layout engine', () => {
  const DENSE = `flowchart TD
  A --> B
  A --> C
  A --> D
  A --> E
  B --> F
  C --> F
  D --> G
  E --> G
  A --> G
  B --> H
  C --> H
  F --> I
  G --> I
  H --> I
  A --> I
`;
  const pos = (r: any) => JSON.stringify(r.value.diagram.nodes.map((n: any) => [n.id, n.position]));
  const routed = (r: any) => r.value.diagram.edges.some((x: any) => x.layoutRouted);

  it('flowchart defaults to auto and is deterministic', async () => {
    expect(createEngine({}).config.layoutEngineByType.flowchart).toBe('auto');
    const ir = IR(null, DENSE);
    expect(pos(await createEngine({}).layoutAsync(ir))).toEqual(pos(await createEngine({}).layoutAsync(ir)));
  });

  it('picks whichever engine scores lower, never worse than dagre', async () => {
    const ir = IR(null, DENSE);
    const mk = (f: string) => createEngine({ config: { layoutEngineByType: { flowchart: f as any } } });
    const { measureLayout } = await import('../src/layout/metrics.js');
    const m = async (f: string) => measureLayout(((await mk(f).layoutAsync(ir)) as any).value.diagram);
    const [d, a] = [await m('dagre'), await m('auto')];
    expect(a.edgeNodeHits + a.edgeOverlaps).toBeLessThanOrEqual(d.edgeNodeHits + d.edgeOverlaps);
    if (a.edgeNodeHits + a.edgeOverlaps === d.edgeNodeHits + d.edgeOverlaps) expect(a.crossings).toBeLessThanOrEqual(d.crossings);
  });

  it('ties go to dagre', async () => {
    const ir = IR(null, 'flowchart TD\n  a[A] --> b[B]\n  b --> c[C]\n');
    const dagre = await createEngine({ config: { layoutEngineByType: { flowchart: 'dagre' } } }).layoutAsync(ir);
    expect(pos(await createEngine({}).layoutAsync(ir))).toEqual(pos(dagre));
  });

  it('autoMaxNodes skips the comparison (dagre output)', async () => {
    const ir = IR(null, DENSE);
    const dagre = await createEngine({ config: { layoutEngineByType: { flowchart: 'dagre' } } }).layoutAsync(ir);
    const skipped = await createEngine({ config: { autoMaxNodes: 2 } }).layoutAsync(ir);
    expect(pos(skipped)).toEqual(pos(dagre));
    expect(routed(skipped)).toBe(false);
  });

  it('explicit layout choices win over auto', async () => {
    const ir = IR(null, DENSE);
    expect(routed(await createEngine({}).layoutAsync(withElk(ir)))).toBe(true);
    const dagreIr = { ...ir, metadata: { ...ir.metadata, layoutEngine: 'dagre' } };
    expect(routed(await createEngine({}).layoutAsync(dagreIr))).toBe(false);
  });

  it('`layout auto` line is accepted; grouped diagrams follow elkWhenGrouped', async () => {
    const auto = { ...IR(null, DENSE) }; auto.metadata = { ...auto.metadata, layoutEngine: 'auto' };
    expect((await createEngine({}).layoutAsync(auto)).ok).toBe(true);
    const grouped = await createEngine({}).layoutAsync(IR(null));
    expect(routed(grouped)).toBe(true);
    const ungroupedPref = await createEngine({ config: { elkWhenGrouped: false } }).layoutAsync(IR(null));
    expect(routed(ungroupedPref)).toBe(false);
  });
});
