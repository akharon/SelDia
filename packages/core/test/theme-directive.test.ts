import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine.js';
import { THEME_RENDER_CONFIG, normalizeThemeId, themeDirective } from '../src/themes.js';

const svgOf = (src: string, render: Record<string, unknown> = {}) => {
  const r = createEngine({ config: { render: render as any } }).compileSync(src);
  expect(r.ok).toBe(true);
  return r.ok ? r.value.svg : '';
};
const fl = (theme: string) => `diagram flowchart "T" {\n  ${theme}\n  a -> b\n}`;

describe('DSL theme directive', () => {
  it('every built-in theme round-trips through its written directive', () => {
    for (const id of Object.keys(THEME_RENDER_CONFIG)) {
      const r = createEngine().parse(fl(themeDirective(id)));
      const ir = r.ok ? createEngine().transform(createEngine().analyze(r.value).value as any) : r;
      expect(ir.ok && normalizeThemeId(ir.value.metadata?.theme as string)).toBe(id);
    }
  });

  it('normalizes aliases and rejects unknown names', () => {
    expect(normalizeThemeId('Clean Dark')).toBe('clean-dark');
    expect(normalizeThemeId('smooth-dark')).toBe('clean-dark');
    expect(normalizeThemeId('mono-light')).toBe('mono');
    expect(normalizeThemeId('my-company')).toBeUndefined();
  });

  it('sets palette and sketchy flag', () => {
    const sketchyDefault = svgOf(fl('theme sketchy light'));
    const clean = svgOf(fl('theme clean light'));
    expect(clean).not.toBe(sketchyDefault);
    expect(clean).toBe(svgOf(fl(''), { sketchy: false }));
    expect(svgOf(fl('theme clean dark'))).toContain('#0f172a');
    expect(svgOf(fl('theme blueprint'))).toContain('#1d4e89');
  });

  it("wins over the host's config theme", () => {
    expect(svgOf(fl('theme clean light'), { theme: 'dark' })).not.toContain('#0f172a');
    expect(svgOf(fl('theme clean dark'), { sketchy: true })).toBe(svgOf(fl('theme clean dark')));
  });
});
