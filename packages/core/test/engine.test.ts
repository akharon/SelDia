// =============================================================================
// SelDiA Core — Engine integration tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/index.js';

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
