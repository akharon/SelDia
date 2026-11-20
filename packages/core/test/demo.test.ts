// =============================================================================
// SelDiA — demo.md is the gallery: it must compile and cover every type
// =============================================================================
// demo.md is the only place a reader sees what SelDiA can draw, so a supported
// diagram type that never appears there is effectively undiscoverable, and a
// block that stopped compiling shows the reader an error box. Both have
// happened; this keeps them from happening quietly.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../src/index.js';

const demoPath = fileURLToPath(new URL('../../../docs/examples/demo-basic.md', import.meta.url));
const engine = createEngine();

function demoBlocks(): string[] {
  return [...readFileSync(demoPath, 'utf8').replace(/\r\n/g, '\n').matchAll(/```seldia\n([\s\S]*?)```/g)].map((m) => m[1]);
}

/** The diagram type the engine actually resolves a block to. */
function typeOf(source: string): string | undefined {
  const parsed = engine.parse(source);
  if (!parsed.ok) return undefined;
  const analyzed = engine.analyze(parsed.value);
  if (!analyzed.ok) return undefined;
  const ir = engine.transform(analyzed.value);
  return ir.ok ? String(ir.value.type) : undefined;
}

describe('demo.md', () => {
  it('has blocks', () => {
    expect(demoBlocks().length).toBeGreaterThan(20);
  });

  it('compiles every block without an error box', () => {
    const failures = demoBlocks()
      .map((src) => ({ head: src.trim().split('\n')[0], result: engine.compileSync(src) }))
      .filter((b) => !b.result.ok)
      .map((b) => `${b.head} -> ${(b.result as any).errors.map((e: any) => e.message).join('; ')}`);
    expect(failures).toEqual([]);
  });

  it('shows every supported diagram type at least once', () => {
    const covered = new Set(demoBlocks().map(typeOf).filter(Boolean));
    const missing = engine.getSupportedDiagramTypes().filter((t) => !covered.has(t));
    expect(missing).toEqual([]);
  });
});
