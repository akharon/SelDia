// =============================================================================
// Parser — declaration forms the shipped examples/ actually use
// =============================================================================
// Every bug covered here was found by compiling examples/*.sld rather than by
// the suite, which never exercised them. They all presented as the same
// misleading `Line 1: No diagram declaration found`.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseDSL } from '../src/parser/parser.js';
import { createEngine } from '../src/index.js';

const EXAMPLES = join(__dirname, '..', '..', '..', 'examples');

function ir(src: string, file?: string) {
  const engine = createEngine();
  const ast = parseDSL(src, file);
  if (!ast.ok) throw new Error(ast.errors.map((e) => `L${e.source.startLine}: ${e.message}`).join('; '));
  const analyzed = engine.analyze(ast.value);
  return engine.transform(analyzed.ok ? analyzed.value : ast.value).value!;
}

describe('leading comments', () => {
  // checkSyntax read the raw first word of the file to find the diagram
  // declaration, so the `// ---` banner every example opens with looked like
  // the declaration and the file was rejected before the parser ever ran.
  it('does not mistake a leading comment for the diagram declaration', () => {
    const r = parseDSL('// a banner\n\ndiagram sequence "T" {\n  a: (Start)\n}');
    expect(r.ok).toBe(true);
  });

  it('still rejects a file with no declaration, reporting the real line', () => {
    const r = parseDSL('// a banner\n\nnot_a_diagram "T" {\n}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Line 3, where the offending text is — not line 1, where the comment is.
    expect(r.errors[0].source.startLine).toBe(3);
  });
});

describe('typed node declarations with a colon', () => {
  it.each([
    ['participant', 'diagram sequence "T" {\n  participant user: "User"\n}', 'user', 'User'],
    ['person', 'diagram c4 context "T" {\n  person customer: "Bank Customer"\n}', 'customer', 'Bank Customer'],
    ['system', 'diagram c4 context "T" {\n  system banking: "Internet Banking"\n}', 'banking', 'Internet Banking'],
  ])('accepts `%s id: "Label"`', (_kw, src, id, label) => {
    const node = ir(src).nodes.find((n) => n.id === id);
    expect(node).toBeDefined();
    expect(node!.label).toBe(label);
  });

  it('keeps the colon-less form working', () => {
    expect(ir('diagram c4 context "T" {\n  person customer "Bank Customer"\n}').nodes[0].label)
      .toBe('Bank Customer');
  });

  it('preserves the C4 _Ext suffix as the type keyword', () => {
    const node = ir('diagram c4 context "T" {\n  system_Ext mainframe: "Mainframe"\n}').nodes[0];
    expect((node.data as any).typeKeyword).toBe('system_ext');
  });

  it('does not steal a keyword being used as a plain node id', () => {
    // `person` is a shape keyword, but here it is the node's own id.
    expect(ir('diagram flowchart "T" {\n  person: (Somebody)\n}').nodes[0].id).toBe('person');
  });
});

describe('unquoted edge labels', () => {
  const SRC = 'diagram sequence "T" {\n  a -> b: GET /authorize\n  b --> a: Show login form\n}';

  // The label loop ran to the closing brace, so the first label swallowed
  // every following statement and a whole diagram collapsed to one edge.
  it('ends an unquoted label at the end of its line', () => {
    const edges = ir(SRC).edges;
    expect(edges).toHaveLength(2);
    expect(edges[0].label).toBe('GET /authorize');
    expect(edges[1].label).toBe('Show login form');
  });

  it('preserves original spacing rather than re-joining tokens with spaces', () => {
    expect(ir(SRC).edges[0].label).toBe('GET /authorize');
    expect(ir(SRC).edges[0].label).not.toBe('GET / authorize');
  });

  it('keeps quotes on a quoted segment inside an unquoted label', () => {
    expect(ir('diagram sequence "T" {\n  a -> b: Click "Login"\n}').edges[0].label)
      .toBe('Click "Login"');
  });
});

describe('sequence control fragments', () => {
  const SRC = [
    'diagram sequence "T" {',
    '  participant a: "A"',
    '  participant b: "B"',
    '  a -> b: start',
    '  alt valid credentials',
    '    b --> a: ok',
    '  else invalid',
    '    b --> a: denied',
    '  end',
    '}',
  ].join('\n');

  // Documented in user_guide.md but with no grammar at all, so any file using
  // them failed outright.
  it('parses alt/else/end and keeps the messages inside as real edges', () => {
    const edges = ir(SRC).edges;
    expect(edges.map((e) => e.label)).toEqual(['start', 'ok', 'denied']);
  });

  it.each(['opt maybe', 'loop retry', 'par', 'critical section', 'break oops'])(
    'parses the `%s` fragment', (header) => {
      const src = `diagram sequence "T" {\n  a -> b: x\n  ${header}\n    b --> a: y\n  end\n}`;
      expect(ir(src).edges.map((e) => e.label)).toEqual(['x', 'y']);
    }
  );

  it('does not treat a fragment keyword as a fragment when it declares a node', () => {
    expect(ir('diagram flowchart "T" {\n  alt: (Alternative)\n  alt --> b\n}').nodes[0].id).toBe('alt');
  });

  it('records the fragment span and section splits on the IR', () => {
    const frags = (ir(SRC).metadata as any).sequenceFragments;
    expect(frags).toHaveLength(1);
    expect(frags[0].keyword).toBe('alt');
    // start message ("start", idx 0) is outside; the two inside are 1 and 2.
    expect(frags[0].firstEdge).toBe(1);
    expect(frags[0].lastEdge).toBe(3);
    expect(frags[0].sections.map((s: any) => s.label)).toEqual(['valid credentials', 'invalid']);
  });

  it('nests fragments by containment span', () => {
    const nested = ir([
      'diagram sequence "N" {',
      '  a -> b: o',
      '  loop retry',
      '    a -> b: i',
      '    opt maybe',
      '      b --> a: d',
      '    end',
      '  end',
      '}',
    ].join('\n'));
    const frags = (nested.metadata as any).sequenceFragments;
    const loop = frags.find((f: any) => f.keyword === 'loop');
    const opt = frags.find((f: any) => f.keyword === 'opt');
    // opt's span sits strictly inside loop's.
    expect(loop.firstEdge).toBeLessThan(opt.firstEdge);
    expect(loop.lastEdge).toBeGreaterThanOrEqual(opt.lastEdge);
  });
});

describe('sequence fragment rendering', () => {
  it('draws a fragment box with a title tab and section divider', async () => {
    const src = [
      'diagram sequence "T" {',
      '  a -> b: start',
      '  alt valid',
      '    b --> a: ok',
      '  else invalid',
      '    b --> a: denied',
      '  end',
      '}',
    ].join('\n');
    const r = await createEngine().compile(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const svg = r.value.svg;
    // One fragment box, with the operator tab and both guards.
    expect((svg.match(/data-seldia-fragment-id/g) || []).length).toBe(1);
    expect(svg).toContain('>ALT<');
    expect(svg).toContain('[valid]');
    expect(svg).toContain('[invalid]'); // else divider label
  });

  it('emits no fragment box for a plain sequence diagram', async () => {
    const r = await createEngine().compile('diagram sequence "T" {\n  a -> b: hi\n}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.svg).not.toContain('seldia-fragment');
  });
});

describe('shipped examples compile', () => {
  const files = readdirSync(EXAMPLES).filter((f) => f.endsWith('.sld'));

  it('finds the example files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s compiles to real SVG', async (file) => {
    const path = join(EXAMPLES, file);
    const result = await createEngine().compile(readFileSync(path, 'utf8'), path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.svg).toContain('<svg');
    // Guard the failure mode a bare `ok` check misses: a file that parses to
    // an empty diagram still "compiles".
    expect(result.value.svg).toContain('data-seldia-node-id');
  });
});
