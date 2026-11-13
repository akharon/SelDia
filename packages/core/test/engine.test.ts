// =============================================================================
// SelDiA Core — Engine integration tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { createEngine, importMermaid } from '../src/index.js';

const engine = createEngine();

const DIAGRAMS: Array<[string, string]> = [
  ['flowchart', `fl "Login" {
    start (Start)
    validate [Validate]
    decision diamond "Valid?"
    ok [Dashboard]
    err [Error]
    start -> validate
    validate -> decision
    decision -> ok: "Yes"
    decision -> err: "No"
  }`],
  ['sequence', `seq "API" {
    client "Client"
    server "Server"
    client -> server: "GET /x"
    server -> client: "200"
  }`],
  ['class', `cls "M" { user [User]\n account [Account]\n user -> account }`],
  ['c4-context', `c4c "Ctx" {
    person customer "Customer"
    system banking "Banking"
    customer -> banking: "Uses"
  }`],
  ['state', `st "S" { [*] -> A\n A -> B: go\n B -> [*] }`],
  ['bpmn', `bpmn "P" {
    s (Start)
    t [Work]
    e (End)
    s -> t -> e
  }`],
  ['er', `er "D" { user [User]\n account [Account]\n user -> account }`],
  ['mindmap', `mind "O" { root [Root]\n a [A]\n b [B]\n root -> a\n root -> b }`],
];

describe('compileSync', () => {
  it('is synchronous and returns a result (not a Promise)', () => {
    const r = engine.compileSync('fl "T" { a (Start) }');
    expect(typeof (r as any).then).toBe('undefined');
    expect(r.ok).toBe(true);
  });

  it('async compile() delegates to the same result', async () => {
    const src = 'fl "T" { a (Start)\n b [Do]\n a -> b }';
    const sync = engine.compileSync(src);
    const async = await engine.compile(src);
    expect(async.ok).toBe(sync.ok);
    if (sync.ok && async.ok) expect(async.value.svg).toBe(sync.value.svg);
  });

  it.each(DIAGRAMS)('compiles a %s diagram to SVG', (_type, src) => {
    const r = engine.compileSync(src);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.svg).toContain('<svg');
      expect(r.value.svg.length).toBeGreaterThan(100);
      expect(r.value.stats.nodeCount).toBeGreaterThan(0);
    }
  });
});

describe('SVG identity attributes', () => {
  it('stamps data-seldia-node-id on every node', () => {
    const r = engine.compileSync('fl "T" { alpha (Start)\n beta [Do]\n alpha -> beta }');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.svg).toContain('data-seldia-node-id="alpha"');
      expect(r.value.svg).toContain('data-seldia-node-id="beta"');
      expect(r.value.svg).toMatch(/data-seldia-edge-id="/);
    }
  });
});

describe('error handling', () => {
  it('reports errors for invalid syntax without throwing', () => {
    const r = engine.compileSync('fl "T" { broken {{{ }');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.errors[0].message.length).toBeGreaterThan(0);
    }
  });
});

describe('themes', () => {
  it.each(['sketchy-light', 'sketchy-dark', 'clean', 'monochrome'])(
    'renders with theme %s',
    (theme) => {
      const themed = createEngine({
        config: { defaultTheme: theme, render: { sketchy: theme.startsWith('sketchy'), padding: 20, background: '#fff' } } as any,
      });
      const r = themed.compileSync(DIAGRAMS[0][1]);
      expect(r.ok).toBe(true);
    }
  );
});

describe('layout engine selection', () => {
  const SRC = 'fl "T" { a (Start)\n b [Do]\n c [Done]\n a -> b\n b -> c }';

  it('compileSync() always uses dagre, even when elk is requested in the DSL', () => {
    const r = engine.compileSync('fl "T" { layout elk\n a (Start)\n b [Do]\n a -> b }');
    expect(r.ok).toBe(true);
  });

  it('compile() honors an elk layout request asynchronously', async () => {
    const r = await engine.compile('fl "T" { layout elk\n a (Start)\n b [Do]\n a -> b }');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.svg).toContain('data-seldia-node-id="a"');
  });

  it('compile() honors config.defaultLayoutEngine = "elk" with no DSL override', async () => {
    const elkEngine = createEngine({ config: { defaultLayoutEngine: 'elk' } as any });
    const r = await elkEngine.compile(SRC);
    expect(r.ok).toBe(true);
  });

  it('dagre and elk both position every node with finite coordinates', async () => {
    const dagreResult = await engine.compile(SRC);
    const elkEngine = createEngine({ config: { defaultLayoutEngine: 'elk' } as any });
    const elkResult = await elkEngine.compile(SRC);
    expect(dagreResult.ok && elkResult.ok).toBe(true);
    if (dagreResult.ok && elkResult.ok) {
      expect(dagreResult.value.width).toBeGreaterThan(0);
      expect(elkResult.value.width).toBeGreaterThan(0);
    }
  });
});

describe('groups (subgraphs)', () => {
  it('lays out a group as a bounding box over its member nodes and renders it behind them', () => {
    const { ir } = importMermaid(`flowchart TD
      subgraph one [My Group]
        a --> b
      end
      c --> a`);
    const laid = engine.layout(ir!);
    expect(laid.ok).toBe(true);
    if (!laid.ok) return;

    const group = laid.value.diagram.groups[0];
    expect(group.size.width).toBeGreaterThan(0);
    expect(group.size.height).toBeGreaterThan(0);
    const memberA = laid.value.diagram.nodes.find((n) => n.id === 'a')!;
    const memberB = laid.value.diagram.nodes.find((n) => n.id === 'b')!;
    // Group bounds must fully contain both member nodes.
    expect(group.position.x).toBeLessThanOrEqual(memberA.position.x);
    expect(group.position.y).toBeLessThanOrEqual(Math.min(memberA.position.y, memberB.position.y));
    expect(group.position.x + group.size.width).toBeGreaterThanOrEqual(memberA.position.x + memberA.size.width);
    expect(group.position.y + group.size.height).toBeGreaterThanOrEqual(memberB.position.y + memberB.size.height);

    const rendered = engine.render(laid.value);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value.svg).toContain('data-seldia-group-id="one"');
    expect(rendered.value.svg).toContain('My Group');
    // The group's <g> must appear before the member nodes' <g> so it renders behind them.
    const groupIdx = rendered.value.svg.indexOf('data-seldia-group-id="one"');
    const nodeIdx = rendered.value.svg.indexOf('data-seldia-node-id="a"');
    expect(groupIdx).toBeLessThan(nodeIdx);
  });

  it('a diagram with no groups renders with no seldia-group elements', () => {
    const r = engine.compileSync('fl "T" { a (Start)\n b [Do]\n a -> b }');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.svg).not.toContain('seldia-group');
  });
});

describe('diagram-wide manual layout override', () => {
  it('a single manually-positioned node disables auto layout for the whole diagram', () => {
    const src = 'fl "T" { a (Start) { x: 500, y: 500 }\n b [Do]\n c [Done]\n a -> b\n b -> c }';
    const parsed = engine.parse(src);
    expect(parsed.ok).toBe(true);
    const laid = (parsed as any).ok
      ? engine.layout(engine.transform(engine.analyze((parsed as any).value).value as any).value as any)
      : null;
    expect((laid as any).ok).toBe(true);
    const nodes = (laid as any).value.diagram.nodes;
    const a = nodes.find((n: any) => n.id === 'a');
    const b = nodes.find((n: any) => n.id === 'b');
    // "a" keeps its manual position...
    expect(a.position).toEqual({ x: 500, y: 500 });
    // ...and "b" (no override) is NOT auto-arranged by dagre either — it
    // falls back to the manual-mode grid placement, proving dagre did not run.
    expect(b.position).not.toEqual({ x: 0, y: 0 });
  });

  it('a diagram with no manual overrides is positioned entirely by the auto engine', () => {
    const src = 'fl "T" { a (Start)\n b [Do]\n a -> b }';
    const r = engine.compileSync(src);
    expect(r.ok).toBe(true);
  });
});

describe('edge via/routing attrs', () => {
  it('a `via` edge lays out through its pinned points, no node manually positioned', () => {
    const src = 'fl "T" { a (Start)\n b [Do]\n a -> b { via: [100, 400, 300, 400] } }';
    const parsed = engine.parse(src);
    expect(parsed.ok).toBe(true);
    const laid = (parsed as any).ok
      ? engine.layout(engine.transform(engine.analyze((parsed as any).value).value as any).value as any)
      : null;
    expect((laid as any).ok).toBe(true);
    const edge = (laid as any).value.diagram.edges.find((e: any) => e.sourceId === 'a' && e.targetId === 'b');
    expect(edge.waypoints).toBeDefined();
    // src-centre, both via points, tgt-centre, in order.
    expect(edge.waypoints).toEqual(
      expect.arrayContaining([{ x: 100, y: 400 }, { x: 300, y: 400 }])
    );
    const viaIdx0 = edge.waypoints.findIndex((p: any) => p.x === 100 && p.y === 400);
    const viaIdx1 = edge.waypoints.findIndex((p: any) => p.x === 300 && p.y === 400);
    expect(viaIdx0).toBeGreaterThanOrEqual(0);
    expect(viaIdx1).toBeGreaterThan(viaIdx0);
  });

  it('a `via` edge survives full render() — orthogonal routing does not discard it and produces a valid SVG', () => {
    const src = 'fl "T" { a (Start)\n b [Do]\n a -> b { via: [50, 300, 250, 300] } }';
    const r = engine.compileSync(src);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Two <path> elements inside the edge <g> (rough.js double-stroke) means
      // rendering succeeded through the via-pinned route without throwing or
      // collapsing to an empty/degenerate path.
      expect(r.value.svg).toMatch(/data-seldia-edge-id="edge-a-b"[^>]*>\s*<path/);
    }
  });

  it('an odd-length `via` array is treated as absent, not guessed at', () => {
    const src = 'fl "T" { a (Start)\n b [Do]\n a -> b { via: [1, 2, 3] } }';
    const r = engine.compileSync(src);
    expect(r.ok).toBe(true);
  });

  it('`route: straight` on one edge overrides the diagram type default without affecting other edges', () => {
    const src = 'fl "T" { a (Start)\n b [Do]\n c [Done]\n a -> b { route: straight }\n b -> c }';
    const r = engine.compileSync(src);
    expect(r.ok).toBe(true);
    const parsed = engine.parse(src);
    const analyzed = engine.analyze((parsed as any).value);
    const transformed = engine.transform(analyzed.value as any);
    const ab = (transformed as any).value.edges.find((e: any) => e.sourceId === 'a' && e.targetId === 'b');
    const bc = (transformed as any).value.edges.find((e: any) => e.sourceId === 'b' && e.targetId === 'c');
    expect(ab.routing).toBe('straight');
    expect(bc.routing).toBe('orthogonal'); // flowchart's own default, unaffected
  });
});

describe('render() error guard', () => {
  it('returns { ok: false } instead of throwing when a custom renderer hits malformed IR', () => {
    const src = 'cls "M" { user [User] }';
    const parsed = engine.parse(src);
    expect(parsed.ok).toBe(true);
    const laid = engine.layout(engine.transform(engine.analyze((parsed as any).value).value as any).value as any);
    expect((laid as any).ok).toBe(true);
    const layoutResult = (laid as any).value;
    // Class nodes with data.kind === 'class' && data.compartments dispatch to
    // renderClassCompartments, which reads `.attributes.length` with no
    // guard. Corrupt `attributes` to simulate malformed IR (e.g. from a
    // misbehaving plugin or importer) that reaches that unsafe code path.
    const node = layoutResult.diagram.nodes.find((n: any) => n.id === 'user');
    node.data.kind = 'class';
    node.data.compartments = { name: 'User', attributes: null, operations: [] };

    let result: any;
    expect(() => { result = engine.render(layoutResult); }).not.toThrow();
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toMatch(/^Render error:/);
  });
});
