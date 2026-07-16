// =============================================================================
// SelDiA Core — Parser / style-block tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/index.js';

const engine = createEngine();

function nodeStyle(src: string, id: string): any {
  const p = engine.parse(src);
  if (!p.ok) throw new Error(p.errors.map((e) => e.message).join('; '));
  const n = (p.value.body as any[]).find((s) => s.kind === 'NodeDecl' && s.id === id);
  return n?.style;
}

describe('inline node style blocks', () => {
  it('parses a flat style block', () => {
    const style = nodeStyle('fl "T" { a (Start) { fill: "#fff", roughness: 2, shadow } }', 'a');
    expect(style).toEqual({ fill: '#fff', roughness: 2, shadow: true });
  });

  it('parses flat x/y layout hints', () => {
    const style = nodeStyle('fl "T" { a [Do] { x: 300, y: 200 } }', 'a');
    expect(style).toEqual({ x: 300, y: 200 });
  });

  it('does not confuse a diamond shape with a style block', () => {
    const style = nodeStyle('fl "T" { d diamond "Valid?" { fill: "red" } }', 'd');
    expect(style).toEqual({ fill: 'red' });
    const p = engine.parse('fl "T" { d diamond "Valid?" { fill: "red" } }');
    const n = (p.ok ? (p.value.body as any[]) : []).find((s) => s.id === 'd');
    expect(n.label).toBe('Valid?');
  });

  it('keeps diagrams without style blocks working', () => {
    const style = nodeStyle('fl "T" { a (Start)\n b [Do]\n a -> b }', 'a');
    expect(style).toBeUndefined();
  });
});

describe('position override end-to-end', () => {
  it('honors a flat x/y override in layout', () => {
    const src = 'fl "T" { a (Start) { x: 500, y: 333 }\n b [Do]\n a -> b }';
    const parsed = engine.parse(src);
    expect(parsed.ok).toBe(true);
    const t = engine.transform(engine.analyze((parsed as any).value).value);
    const laid = engine.layout((t as any).value);
    const a = (laid as any).value.diagram.nodes.find((n: any) => n.id === 'a');
    expect(a.position).toEqual({ x: 500, y: 333 });
  });
});

describe('arrow tokenization', () => {
  it('accepts arrows without surrounding spaces', () => {
    expect(engine.compileSync('fl "T" { a (S)\n b [D]\n a->b }').ok).toBe(true);
    expect(engine.compileSync('fl "T" { a (S)\n b [D]\n a->b }').ok).toBe(true);
  });
  it('still allows hyphens inside identifiers', () => {
    const r = engine.compileSync('fl "T" { my-node (S)\n other [D]\n my-node -> other }');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.svg).toContain('data-seldia-node-id="my-node"');
  });
});

describe('edge style blocks', () => {
  it('parses an edge style block', () => {
    const p = engine.parse('fl "T" { a (S)\n b [D]\n a -> b { stroke: "#f00" } }');
    expect(p.ok).toBe(true);
    const e = (p.ok ? (p.value.body as any[]) : []).find((s) => s.kind === 'EdgeDecl');
    expect(e.style).toEqual({ stroke: '#f00' });
  });
});

describe('bare theme declarations', () => {
  it('accepts bare theme name with keyword', () => {
    const p = engine.parse('fl "T" { sketchy dark\n a (S) }');
    expect(p.ok).toBe(true);
    const t = (p.ok ? (p.value.body as any[]) : []).find((s) => s.kind === 'ThemeDecl');
    expect(t.theme).toBe('sketchy-dark');
  });

  it('still accepts theme with keyword', () => {
    const p = engine.parse('fl "T" { theme "sketchy-dark"\n a (S) }');
    expect(p.ok).toBe(true);
  });

  it('accepts layout direction', () => {
    const p = engine.parse('fl "T" { layout tb\n a (S) }');
    expect(p.ok).toBe(true);
    const l = (p.ok ? (p.value.body as any[]) : []).find((s) => s.kind === 'LayoutDecl');
    expect(l.options.direction).toBe('TB');
  });
});

describe('group declarations', () => {
  it('accepts a quoted label directly as the group name', () => {
    const p = engine.parse('block "T" { group "Entry Points" { a (S) } }');
    expect(p.ok).toBe(true);
    const g = (p.ok ? (p.value.body as any[]) : []).find((s) => s.kind === 'GroupDecl');
    expect(g.label).toBe('Entry Points');
    expect(g.id).toBe('entry-points');
  });

  it('still accepts a bare identifier group name', () => {
    const p = engine.parse('block "T" { group cluster1 { a (S) } } ');
    expect(p.ok).toBe(true);
    const g = (p.ok ? (p.value.body as any[]) : []).find((s) => s.kind === 'GroupDecl');
    expect(g.id).toBe('cluster1');
  });
});

describe('reserved keywords used as plain node identifiers', () => {
  it('allows "layout", "theme", "style", "group", "section" as node ids', () => {
    const src = 'fl "T" { layout [Layout Engine]\n theme [Theme Manager]\n layout -> theme }';
    const r = engine.compileSync(src);
    expect(r.ok).toBe(true);
  });

  it('allows a keyword as node id', () => {
    const r = engine.compileSync('block "T" { block "Theme Manager" }');
    expect(r.ok).toBe(true);
  });

  it('allows "diagram" as a node id and edge endpoint', () => {
    const r = engine.compileSync('block "T" { node_a "Diagram Node"\n a (S)\n node_a -> a }');
    expect(r.ok).toBe(true);
  });
});

describe('C4 rich metadata (multiple description strings)', () => {
  it('folds extra strings after a typed-node label into the description', () => {
    const p = engine.parse('c4c "T" { system mainframe "Mainframe Banking" "Core banking system" }');
    expect(p.ok).toBe(true);
    const n = (p.ok ? (p.value.body as any[]) : []).find((s) => s.kind === 'NodeDecl');
    expect(n.label).toBe('Mainframe Banking');
    expect(n.description).toBe('Core banking system');
  });

  it('folds extra strings after a person keyword label', () => {
    const p = engine.parse('c4c "T" { person customer "Customer" "A bank customer" }');
    expect(p.ok).toBe(true);
    const n = (p.ok ? (p.value.body as any[]) : []).find((s) => s.kind === 'NodeDecl');
    expect(n.label).toBe('Customer');
    expect(n.description).toBe('A bank customer');
  });

  it('joins multiple extra strings (technology + description) with an em dash', () => {
    const p = engine.parse('c4con "T" { container spa "SPA" "React" "Client-side application" }');
    expect(p.ok).toBe(true);
    const n = (p.ok ? (p.value.body as any[]) : []).find((s) => s.kind === 'NodeDecl');
    expect(n.description).toBe('React — Client-side application');
  });

  it('compiles c4 container and c4 component diagrams', () => {
    const container = engine.compileSync('c4con "T" { container api "API" }');
    expect(container.ok).toBe(true);
    const component = engine.compileSync('c4comp "T" { component svc "Service" }');
    expect(component.ok).toBe(true);
  });
});

describe('dmn diagram type', () => {
  it('compiles a basic dmn diagram using the generic node/edge subset', () => {
    const r = engine.compileSync('dmn "T" { age "Input: Age"\n approve "Rule: Approve"\n age -> approve }');
    expect(r.ok).toBe(true);
  });
});
