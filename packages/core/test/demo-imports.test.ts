// =============================================================================
// SelDiA — the import galleries must keep compiling
// =============================================================================
// demo-mermaid.md and demo-plantuml.md are the only place a reader sees what
// SelDiA accepts as an *input format*. demo.test.ts already guards demo-basic.md for
// the native DSL; these two shipped unguarded, so a fence that stopped
// importing would show readers an error box (or silently degrade to plain
// code) with nothing failing. Both galleries also make specific claims about
// coverage and fallback behaviour, which are asserted here rather than trusted.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../src/index.js';
import { importMermaid } from '../src/import/mermaid.js';
import { importPlantUml } from '../src/import/plantuml.js';

const engine = createEngine();
const read = (name: string) => readFileSync(fileURLToPath(new URL(`../../../docs/examples/${name}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

function fences(md: string, lang: string): string[] {
  return [...md.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g'))].map((m) => m[1]);
}

/** Import a block and push it through the engine to SVG. Returns null when the
 *  importer declines the block — the documented degrade-to-plain-fence path,
 *  which is a valid outcome, not a failure. */
function compile(source: string, importer: (s: string) => { ir: unknown; diagnostics: unknown[] }) {
  const { ir, diagnostics } = importer(source) as { ir: any; diagnostics: any[] };
  if (!ir) return null;
  expect(diagnostics, `diagnostics for "${source.trim().split('\n')[0]}"`).toEqual([]);
  const result = engine.compileIRSync(ir);
  expect(result.ok, result.ok ? '' : JSON.stringify(result).slice(0, 300)).toBe(true);
  return String(ir.type);
}

describe('demo-plantuml.md', () => {
  const md = read('demo-plantuml.md');
  const blocks = fences(md, 'plantuml');

  it('has a block per documented family', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(11);
  });

  it('imports and renders every diagram block', () => {
    const types = blocks.map((b) => compile(b, importPlantUml)).filter(Boolean);
    expect(types).toEqual([
      'sequence', 'class', 'er', 'usecase', 'activity',
      'state', 'component', 'deployment', 'mindmap', 'gantt',
    ]);
  });

  // The gallery explicitly promises @startjson degrades rather than erroring.
  it('declines the unsupported block instead of erroring on it', () => {
    const json = blocks.find((b) => b.includes('@startjson'));
    expect(json, 'no @startjson block in the gallery').toBeDefined();
    expect(importPlantUml(json!).ir).toBeFalsy();
  });

  it('renders its native flowchart block too', () => {
    for (const b of fences(md, 'seldia')) expect(engine.compileSync(b).ok).toBe(true);
  });
});

describe('demo-mermaid.md', () => {
  const blocks = fences(read('demo-mermaid.md'), 'mermaid');

  it('has a block per documented type', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(9);
  });

  it('imports and renders every block', () => {
    const failures = blocks
      .map((b) => ({ head: b.trim().split('\n')[0], type: compile(b, importMermaid) }))
      .filter((b) => b.type === null)
      .map((b) => b.head);
    expect(failures).toEqual([]);
  });
});
