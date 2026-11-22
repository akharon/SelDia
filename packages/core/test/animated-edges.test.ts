import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createEngine } from '../src/engine.js';
import { parseDSL } from '../src/parser/index.js';
import { importMermaid } from '../src/import/mermaid.js';
import { exportMermaid } from '../src/export/mermaid.js';
import { exportPlantUml } from '../src/export/plantuml.js';

const engine = createEngine();
const svgOf = (src: string) => {
  const r = engine.compileSync(src);
  expect(r.ok).toBe(true);
  return r.ok ? r.value.svg : '';
};
const corpus = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mermaid-corpus', 'flowchart-animated.mmd'), 'utf-8');

describe('animated edges: DSL + renderer', () => {
  it('bare { animate } and speeds reach the IR and the SVG', () => {
    const svg = svgOf('fl "T" { a -> b { animate }\n b -> c { animate: fast }\n c -> d { animate: slow }\n d -> e }');
    expect(svg).toContain('class="seldia-edge seldia-flow"');
    expect(svg).toContain('class="seldia-edge seldia-flow seldia-flow-fast"');
    expect(svg).toContain('class="seldia-edge seldia-flow seldia-flow-slow"');
    expect((svg.match(/seldia-flow[ "]/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(svg).toContain('@keyframes seldia-flow');
    expect(svg).toContain('prefers-reduced-motion:no-preference');
    expect(svg).toContain('stroke-dasharray="6 4"');
  });
  it('non-animated diagrams carry no keyframes or flow classes', () => {
    const svg = svgOf('fl "T" { a -> b { animate: false }\n b -> c }');
    expect(svg).not.toContain('seldia-flow');
    expect(svg).not.toContain('@keyframes');
  });
  it('hover rules are scoped away from the interactive host', () => {
    expect(svgOf('fl "T" { a -> b }')).toContain('svg:not(.sd-interactive)');
  });
  it('AST edge style animate survives to the IR', () => {
    const r = parseDSL('fl "T" { a -> b { animate: fast } }');
    expect(JSON.stringify(r)).toContain('"animate":"fast"');
  });
});

describe('animated edges: Mermaid + PlantUML', () => {
  it('imports edge ids and animate properties', () => {
    const { ir, diagnostics } = importMermaid(corpus);
    expect(diagnostics).toHaveLength(0);
    expect(ir!.nodes).toHaveLength(4);
    expect(ir!.edges.map((e) => e.style.animate)).toEqual([true, 'fast', undefined]);
    const r = engine.compileIRSync(ir!);
    expect(r.ok && r.value.svg).toContain('seldia-flow');
  });
  it('exports ids + property lines and round-trips', () => {
    const { ir } = importMermaid(corpus);
    const out = exportMermaid(ir!)!;
    expect(out).toMatch(/e1@-->/);
    expect(out).toContain('e1@{ animate: true }');
    expect(out).toContain('e2@{ animation: fast }');
    const back = importMermaid(out).ir!;
    expect(back.edges.map((e) => e.style.animate)).toEqual([true, 'fast', undefined]);
  });
  it('plain edges export unchanged and PlantUML falls back to dotted', () => {
    expect(exportMermaid(importMermaid('flowchart TD\n a --> b').ir!)).not.toContain('@');
    const { ir } = importMermaid(corpus);
    expect(exportPlantUml(ir!) ?? '..>').toContain('..>');
  });
});
