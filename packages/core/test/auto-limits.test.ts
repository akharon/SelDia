import { describe, it, expect, vi } from 'vitest';
import { createEngine } from '../src/engine.js';
import * as elk from '../src/layout/engines.js';

function gen(n: number, fan: number): string {
  let s = 'fl "T" {\n';
  for (let i = 0; i < n; i++) s += `  n${i} [Node ${i}]\n`;
  for (let i = 0; i < n; i++) for (let j = 1; j <= fan; j++) { const t = (i * 7 + j * 13) % n; if (t !== i) s += `  n${i} -> n${t}\n`; }
  return s + '}\n';
}

describe('auto layout limits', () => {
  it('perf guard: 60-node, 3-out-degree flowchart compiles under 5s', async () => {
    const e = createEngine({ config: { layoutEngineByType: { flowchart: 'auto' } } } as any);
    const t = Date.now();
    await e.compile(gen(60, 3));
    expect(Date.now() - t).toBeLessThan(5000);
  }, 30000);

  it('autoMaxEdges: above the cap auto falls back to dagre without running ELK', async () => {
    const spy = vi.spyOn(elk, 'layoutWithElkSync');
    const mk = (maxEdges: number) => createEngine({ config: { autoMaxEdges: maxEdges, layoutEngineByType: { flowchart: 'auto' } } } as any);
    spy.mockClear();
    await mk(5).compile(gen(10, 3));
    expect(spy).not.toHaveBeenCalled();
    await mk(500).compile(gen(10, 3));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  }, 30000);
});
