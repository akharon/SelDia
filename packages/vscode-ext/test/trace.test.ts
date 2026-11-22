// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@seldia/core/render/flow-css', () => ({ INTERACTIVE_FLOW_CSS: '' }));
import { buildGraph, computeFocus } from '../src/markdown-preview/trace.js';

const g = buildGraph([
  { id: 'e1', src: 'a', tgt: 'b' },
  { id: 'e2', src: 'b', tgt: 'c' },
  { id: 'e3', src: 'c', tgt: 'd' },
  { id: 'e4', src: 'x', tgt: 'b' },
  { id: 'e5', src: 'y', tgt: 'z' },
]);
const sorted = (s: Set<string>) => [...s].sort();

describe('trace focus', () => {
  it('node hover: incident edges and neighbours only', () => {
    const f = computeFocus(g, { node: 'b' });
    expect(sorted(f.edges)).toEqual(['e1', 'e2', 'e4']);
    expect(sorted(f.nodes)).toEqual(['a', 'b', 'c', 'x']);
  });
  it('transitive: full upstream and downstream, not unrelated components', () => {
    const f = computeFocus(g, { node: 'b' }, true);
    expect(sorted(f.edges)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(sorted(f.nodes)).toEqual(['a', 'b', 'c', 'd', 'x']);
  });
  it('edge: itself and endpoints', () => {
    const f = computeFocus(g, { edge: 'e3' });
    expect(sorted(f.edges)).toEqual(['e3']);
    expect(sorted(f.nodes)).toEqual(['c', 'd']);
  });
  it('terminates on cycles and caps size', () => {
    const cyc = buildGraph([{ id: 'p', src: 'a', tgt: 'b' }, { id: 'q', src: 'b', tgt: 'a' }]);
    expect(computeFocus(cyc, { node: 'a' }, true).nodes.size).toBe(2);
    const chain = buildGraph(Array.from({ length: 2000 }, (_, i) => ({ id: 'e' + i, src: 'n' + i, tgt: 'n' + (i + 1) })));
    const f = computeFocus(chain, { node: 'n0' }, true);
    expect(f.nodes.size + f.edges.size).toBeLessThanOrEqual(502);
  });
});

describe('stripClientArtifacts', () => {
  it('removes hit clones, client classes and the injected style', async () => {
    const { stripClientArtifacts } = await import('../src/markdown-preview/trace.js');
    const mk = (cls: string[]) => { const s = new Set(cls); return { classList: { remove: (...c: string[]) => c.forEach((x) => s.delete(x)) }, getAttribute: () => (s.size ? [...s].join(' ') : ''), removeAttribute: vi.fn(), s }; };
    const removed: string[] = [];
    const node = mk(['seldia-node', 'sd-on']);
    const root: any = { ...mk(['sd-interactive', 'sd-trace']), querySelectorAll: (q: string) => q.includes('.sd-hit') ? [{ remove: () => removed.push('hit') }] : [node] };
    stripClientArtifacts(root);
    expect(removed).toEqual(['hit']);
    expect([...node.s]).toEqual(['seldia-node']);
    expect(root.s.size).toBe(0);
  });
});
