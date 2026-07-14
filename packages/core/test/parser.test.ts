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
