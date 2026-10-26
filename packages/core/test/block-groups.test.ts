import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine.js';

describe('block diagram groups', () => {
  it('keeps nodes and edges declared inside group bodies', () => {
    const r = createEngine().compileSync('block "T" {\n group "G" {\n a [A]\n b [B]\n }\n group "H" {\n c [C]\n }\n a -> b\n b -> c\n}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const svg = r.value.svg;
    const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!;
    expect(Number(m[1])).toBeGreaterThan(100);
    for (const t of ['>A<', '>B<', '>C<', 'G', 'H']) expect(svg).toContain(t);
  });
});

describe('component diagram groups', () => {
  it('keeps nodes and edges declared inside group bodies', () => {
    const r = createEngine().compileSync('component "T" {\n group "G" {\n a [A]\n b [B]\n }\n group "H" {\n c [C]\n }\n a -> b\n b -> c\n}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const svg = r.value.svg;
    for (const t of ['>A<', '>B<', '>C<', 'G', 'H']) expect(svg).toContain(t);
  });
});
