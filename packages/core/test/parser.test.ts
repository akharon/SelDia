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
    const style = nodeStyle('diagram flowchart "T" { a: (Start) { fill: "#fff", roughness: 2, shadow } }', 'a');
    expect(style).toEqual({ fill: '#fff', roughness: 2, shadow: true });
  });

  it('parses flat x/y layout hints', () => {
    const style = nodeStyle('diagram flowchart "T" { a: [Do] { x: 300, y: 200 } }', 'a');
    expect(style).toEqual({ x: 300, y: 200 });
  });

  it('does not confuse a diamond shape with a style block', () => {
    const style = nodeStyle('diagram flowchart "T" { d: {Valid?} { fill: "red" } }', 'd');
    expect(style).toEqual({ fill: 'red' });
    const p = engine.parse('diagram flowchart "T" { d: {Valid?} { fill: "red" } }');
    const n = (p.ok ? (p.value.body as any[]) : []).find((s) => s.id === 'd');
    expect(n.label).toBe('Valid?');
  });

  it('keeps diagrams without style blocks working', () => {
    const style = nodeStyle('diagram flowchart "T" { a: (Start)\n b: [Do]\n a --> b }', 'a');
    expect(style).toBeUndefined();
  });
});

describe('position override end-to-end', () => {
  it('honors a flat x/y override in layout', () => {
    const src = 'diagram flowchart "T" { a: (Start) { x: 500, y: 333 }\n b: [Do]\n a --> b }';
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
    expect(engine.compileSync('diagram flowchart "T" { a:(S)\n b:[D]\n a-->b }').ok).toBe(true);
    expect(engine.compileSync('diagram flowchart "T" { a:(S)\n b:[D]\n a->b }').ok).toBe(true);
  });
  it('still allows hyphens inside identifiers', () => {
    const r = engine.compileSync('diagram flowchart "T" { my-node:(S)\n other:[D]\n my-node --> other }');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.svg).toContain('data-seldia-node-id="my-node"');
  });
});

describe('edge style blocks', () => {
  it('parses an edge style block', () => {
    const p = engine.parse('diagram flowchart "T" { a: (S)\n b: [D]\n a --> b { stroke: "#f00" } }');
    expect(p.ok).toBe(true);
    const e = (p.ok ? (p.value.body as any[]) : []).find((s) => s.kind === 'EdgeDecl');
    expect(e.style).toEqual({ stroke: '#f00' });
  });
});

describe('bare identifier theme/layout declarations', () => {
  it('accepts a bare identifier for theme (not just a quoted string)', () => {
    const p = engine.parse('diagram flowchart "T" { theme sketchy-dark\n a: (S) }');
    expect(p.ok).toBe(true);
    const t = (p.ok ? (p.value.body as any[]) : []).find((s) => s.kind === 'ThemeDecl');
    expect(t.theme).toBe('sketchy-dark');
  });

  it('still accepts a quoted theme name', () => {
    const p = engine.parse('diagram flowchart "T" { theme "sketchy-dark"\n a: (S) }');
    expect(p.ok).toBe(true);
  });

  it('accepts a bare identifier for layout engine', () => {
    const p = engine.parse('diagram flowchart "T" { layout dagre-alt\n a: (S) }');
    expect(p.ok).toBe(true);
    const l = (p.ok ? (p.value.body as any[]) : []).find((s) => s.kind === 'LayoutDecl');
    expect(l.engine).toBe('dagre-alt');
  });
});

describe('group declarations', () => {
  it('accepts a quoted label directly as the group name', () => {
    const p = engine.parse('diagram block "T" { group "Entry Points" { a: (S) } }');
    expect(p.ok).toBe(true);
    const g = (p.ok ? (p.value.body as any[]) : []).find((s) => s.kind === 'GroupDecl');
    expect(g.label).toBe('Entry Points');
    expect(g.id).toBe('entry-points');
  });

  it('still accepts a bare identifier group name', () => {
    const p = engine.parse('diagram block "T" { group cluster1 { a: (S) } } ');
    expect(p.ok).toBe(true);
    const g = (p.ok ? (p.value.body as any[]) : []).find((s) => s.kind === 'GroupDecl');
    expect(g.id).toBe('cluster1');
  });
});

describe('reserved keywords used as plain node identifiers', () => {
  it('allows "layout", "theme", "style", "group", "section" as node ids', () => {
    const src = 'diagram flowchart "T" { layout: [Layout Engine]\n theme: [Theme Manager]\n layout --> theme }';
    const r = engine.compileSync(src);
    expect(r.ok).toBe(true);
  });

  it('allows a keyword as the id in a typed-node decl (e.g. block theme: "...")', () => {
    const r = engine.compileSync('diagram block "T" { block theme: "Theme Manager" }');
    expect(r.ok).toBe(true);
  });

  it('allows "diagram" as a node id and edge endpoint', () => {
    const r = engine.compileSync('diagram block "T" { block diagram: "Diagram Node"\n a: (S)\n diagram --> a }');
    expect(r.ok).toBe(true);
  });
});

describe('C4 rich metadata (multiple description strings)', () => {
  it('folds extra strings after a typed-node label into the description', () => {
    const p = engine.parse('diagram c4 context "T" { system_Ext mainframe: "Mainframe Banking" "Core banking system" }');
    expect(p.ok).toBe(true);
    const n = (p.ok ? (p.value.body as any[]) : []).find((s) => s.kind === 'NodeDecl');
    expect(n.label).toBe('Mainframe Banking');
    expect(n.description).toBe('Core banking system');
  });

  it('folds extra strings after a participant-keyword label (person/container/...)', () => {
    const p = engine.parse('diagram c4 context "T" { person customer: "Customer" "A bank customer" }');
    expect(p.ok).toBe(true);
    const n = (p.ok ? (p.value.body as any[]) : []).find((s) => s.kind === 'NodeDecl');
    expect(n.label).toBe('Customer');
    expect(n.description).toBe('A bank customer');
  });

  it('joins multiple extra strings (technology + description) with an em dash', () => {
    const p = engine.parse('diagram c4 container "T" { container spa: "SPA" "React" "Client-side application" }');
    expect(p.ok).toBe(true);
    const n = (p.ok ? (p.value.body as any[]) : []).find((s) => s.kind === 'NodeDecl');
    expect(n.description).toBe('React — Client-side application');
  });

  it('compiles diagram c4 container and diagram c4 component (registered plugins)', () => {
    const container = engine.compileSync('diagram c4 container "T" { container api: "API" }');
    expect(container.ok).toBe(true);
    const component = engine.compileSync('diagram c4 component "T" { component svc: "Service" }');
    expect(component.ok).toBe(true);
  });
});

describe('dmn diagram type', () => {
  it('compiles a basic dmn diagram using the generic node/edge subset', () => {
    const r = engine.compileSync('diagram dmn "T" { age: "Input: Age"\n approve: "Rule: Approve"\n age --> approve }');
    expect(r.ok).toBe(true);
  });
});
