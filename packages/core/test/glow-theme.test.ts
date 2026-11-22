import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine.js';
import { parseDSL } from '../src/parser/index.js';
import { BUILTIN_THEMES } from '../src/themes.js';
import { blendHex } from '../src/render/design-system.js';
import { TRACE_CSS, FLOW_KEYFRAMES_CSS } from '../src/render/flow-css.js';

const svgOf = (src: string, render: Record<string, unknown> = {}, themes?: any[]) => {
  const r = createEngine({ config: { render: render as any }, themes }).compileSync(src);
  expect(r.ok).toBe(true);
  return r.ok ? r.value.svg : '';
};
const SRC = 'fl "T" { a -> b\n b -> c }';

describe('glow themes', () => {
  it('are registered with effects and non-sketchy', () => {
    for (const id of ['glow-dark', 'glow-light']) {
      const t = BUILTIN_THEMES.find((x) => x.id === id)!;
      expect(t.sketchy).toBe(false);
      expect(t.effects).toMatchObject({ glow: true, accentBar: true });
    }
  });
  it('config theme glow-dark: tint hex computed, accent bar, glow filter, dark bg', () => {
    const svg = svgOf(SRC, { theme: 'glow-dark' });
    // flowchart accent #4f46e5 maps to #3b82f6; fill = 16% accent over #1e1e1e, as plain hex.
    expect(svg).toContain(`fill="${blendHex('#1e1e1e', '#3b82f6', 0.16)}"`);
    expect(svg).not.toContain('color-mix');
    expect(svg).toContain('data-accent-bar="1"');
    expect(svg).toContain('<filter id="seldia-glow"');
    expect(svg).toContain('feDropShadow');
    expect(svg).toContain('class="seldia-diagram-svg-el seldia-glow"');
    expect(svg).toContain('fill="#1e1e1e"');
    expect(svg).not.toContain('seldia-flow"'); // trace default: nothing flows in the file
  });
  it('DSL `theme glow dark` and bare `glow light` select the themes', () => {
    expect(parseDSL('fl "T" { theme glow dark\n a -> b }')).toBeTruthy();
    expect(svgOf('fl "T" { theme glow dark\n a -> b }')).toContain('seldia-glow');
    const light = svgOf('fl "T" { glow light\n a -> b }');
    expect(light).toContain('seldia-glow');
    expect(light).toContain('fill="#fafafa"');
    // a node that happens to be called glow still parses as a node
    expect(svgOf('fl "T" { glow (Glow)\n glow -> b }')).not.toContain('seldia-glow');
    // host default theme names don't block the DSL directive
    expect(svgOf('fl "T" { theme glow dark\n a -> b }', { theme: 'sketchy-light' })).toContain('seldia-glow');
  });
  it('directive variant is case-insensitive', () => {
    expect(svgOf('fl "T" { glow Dark\n a -> b }')).toContain('fill="#1e1e1e"');
    expect(svgOf('fl "T" { theme Glow LIGHT\n a -> b }')).toContain('fill="#fafafa"');
  });
  it('existing themes and default output are untouched', () => {
    const plain = svgOf(SRC);
    expect(plain).not.toContain('seldia-glow');
    expect(plain).not.toContain('data-accent-bar');
    expect(plain).not.toContain('<defs>');
  });
  it('accent bar skips diamonds', () => {
    const svg = svgOf('fl "T" { d diamond "Check"\n d -> b }', { theme: 'glow-dark' });
    const bars = (svg.match(/data-accent-bar/g) || []).length;
    expect(bars).toBeLessThanOrEqual(1);
  });
  it('flow:all animates every edge; cap and denied types fall back', () => {
    const all = [{ ...BUILTIN_THEMES.find((t) => t.id === 'glow-dark')!, id: 'glow-all', effects: { flow: 'all' as const, glow: true } }];
    const svg = svgOf(SRC, { theme: 'glow-all' }, all);
    expect((svg.match(/class="seldia-edge seldia-flow"/g) || []).length).toBe(2);
    expect(svg).toContain('@keyframes seldia-flow');
    // explicit animate:false stays still
    expect((svgOf('fl "T" { a -> b { animate: false }\n b -> c }', { theme: 'glow-all' }, all).match(/class="seldia-edge seldia-flow"/g) || []).length).toBe(1);
    // over the edge cap: no auto flow
    const many = 'fl "T" {\n' + Array.from({ length: 301 }, (_, i) => `n${i} -> n${i + 1}`).join('\n') + '\n}';
    expect(svgOf(many, { theme: 'glow-all' }, all)).not.toContain('class="seldia-edge seldia-flow"');
    // structural types ignore it
    const cls = svgOf('class "T" { A -> B { animate } }', { theme: 'glow-all' }, all);
    expect(cls).not.toContain('seldia-flow"');
  });
  it('flow:none puts seldia-noflow on the root and TRACE_CSS honours it', () => {
    const none = [{ ...BUILTIN_THEMES.find((t) => t.id === 'glow-dark')!, id: 'glow-none', effects: { flow: 'none' as const } }];
    expect(svgOf(SRC, { theme: 'glow-none' }, none)).toContain('seldia-noflow');
    expect(TRACE_CSS).toContain('.sd-trace:not(.seldia-noflow)');
    expect(FLOW_KEYFRAMES_CSS).toContain('.seldia-noflow .seldia-flow');
  });
  it('glow is skipped above 200 nodes', () => {
    const big = 'fl "T" {\n' + Array.from({ length: 201 }, (_, i) => `n${i} (N${i})`).join('\n') + '\n}';
    const svg = svgOf(big, { theme: 'glow-dark' });
    expect(svg).not.toContain('seldia-glow');
  });
});

describe('animate across diagram types', () => {
  it('flows on state, activity, sequence; `~~>` is animated sugar', () => {
    expect(svgOf('state "T" { a -> b { animate } }')).toContain('seldia-flow');
    expect(svgOf('activity "T" { a -> b { animate } }')).toContain('seldia-flow');
    expect(svgOf('sequence "T" { a -> b: hi { animate }\n }', { sketchy: false })).toContain('seldia-flow');
    const s = svgOf('fl "T" { a ~~> b\n b -> c }');
    expect((s.match(/class="seldia-edge seldia-flow"/g) || []).length).toBe(1);
    expect(svgOf('class "T" { A -> B { animate } }')).not.toContain('seldia-flow');
  });
  it("glow filter region is in user space so straight (zero-width bbox) edges stay visible", () => {
    const svg = svgOf('fl "T" { glow dark\n a -> b { animate } }');
    expect(svg).toMatch(/<filter id="seldia-glow" filterUnits="userSpaceOnUse"/);
    expect(svg).not.toMatch(/<filter id="seldia-glow" x="-30%"/);
  });
});
