// =============================================================================
// SelDiA — Theme/Palette Override Tests
// =============================================================================
// The theme mechanism (render/design-system.ts PaletteOverride + engine.ts
// config.render.theme/palette) swaps node/edge/background colors without
// forking any renderer code. These tests assert the swap is actually visible
// in rendered SVG output, and that it never leaks between separate compiles.

import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine.js';
import { BUILTIN_PALETTES, resolvePalette } from '../src/render/design-system.js';

// Plain `(…)` process nodes on purpose: `[Start]`/`[End]` render with semantic
// ROLE colors (green/red), never the flowchart type accent, so a fixture built
// from them can't observe an accent swap at all. These carry the type accent.
const SOURCE = `diagram flowchart "T" {
    a: (Alpha)
    b: (Beta)
    a --> b
}`;

// Role-colored counterpart, for asserting that an override reaches role
// swatches too (a dark palette must not leave a light-mode green on near-black).
const ROLE_SOURCE = `diagram flowchart "T" {
    a: [Start]
    b: [End]
    a --> b
}`;

/** Default flowchart type accent (design-system.ts TYPE_ACCENTS.flowchart). */
const DEFAULT_ACCENT = '#4f46e5';

describe('resolvePalette', () => {
  it('resolves a built-in palette name', () => {
    expect(resolvePalette('dark')).toBe(BUILTIN_PALETTES.dark);
  });

  it('passes through a custom PaletteOverride object unchanged', () => {
    const custom = { nodeStroke: '#123456' };
    expect(resolvePalette(custom)).toBe(custom);
  });

  it('returns undefined for no input', () => {
    expect(resolvePalette(undefined)).toBeUndefined();
  });
});

describe('engine theme rendering', () => {
  it('renders default colors with no theme configured', () => {
    const engine = createEngine();
    const result = engine.compileSync(SOURCE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    // Default flowchart accent stroke.
    expect(result.value.svg).toContain(DEFAULT_ACCENT);
  });

  it('applies the built-in "dark" palette by name via config.render.theme', () => {
    const engine = createEngine({ config: { render: { theme: 'dark' } } });
    const result = engine.compileSync(SOURCE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.value.svg).toContain(BUILTIN_PALETTES.dark.nodeStroke);
    expect(result.value.svg).toContain(BUILTIN_PALETTES.dark.background);
    expect(result.value.svg).not.toContain(DEFAULT_ACCENT); // default accent should be gone
  });

  it('applies the built-in "high-contrast" palette', () => {
    const engine = createEngine({ config: { render: { theme: 'high-contrast' } } });
    const result = engine.compileSync(SOURCE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.value.svg).toContain('#000000');
  });

  it('applies a fully custom palette color map via config.render.palette', () => {
    const engine = createEngine({
      config: { render: { palette: { nodeStroke: '#ff00aa', background: '#00ffcc' } } },
    });
    const result = engine.compileSync(SOURCE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.value.svg).toContain('#ff00aa');
    expect(result.value.svg).toContain('#00ffcc');
  });

  it('does not leak a palette override between separate engine instances', () => {
    const themed = createEngine({ config: { render: { theme: 'dark' } } });
    const plain = createEngine();
    const r1 = themed.compileSync(SOURCE);
    const r2 = plain.compileSync(SOURCE);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) throw new Error();
    expect(r2.value.svg).toContain(DEFAULT_ACCENT);
    expect(r2.value.svg).not.toContain(BUILTIN_PALETTES.dark.nodeStroke);
  });

  it('does not leak a palette override between successive compiles on the same engine', () => {
    const engine = createEngine({ config: { render: { theme: 'dark' } } });
    const r1 = engine.compileSync(SOURCE);
    expect(r1.ok).toBe(true);

    const plain = createEngine();
    const r2 = plain.compileSync(SOURCE);
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error();
    expect(r2.value.svg).toContain(DEFAULT_ACCENT);
  });

  it('applies the override to semantic ROLE colors, not just type accents', () => {
    // Regression: roleSwatch() used to return raw swatches without consulting
    // the active override, so a dark theme left `[Start]`'s light-mode green
    // fill (#e9fbef) sitting on a near-black (#0f172a) background.
    const engine = createEngine({ config: { render: { theme: 'dark' } } });
    const result = engine.compileSync(ROLE_SOURCE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.value.svg).not.toContain('#e9fbef'); // light-mode start fill
    expect(result.value.svg).not.toContain('#fdecec'); // light-mode stop fill
    expect(result.value.svg).toContain(BUILTIN_PALETTES.dark.nodeFill);
  });

  it('preserves other render config when only theme is overridden (merge, not shallow-replace)', () => {
    const engine = createEngine({ config: { render: { theme: 'dark', padding: 40 } } });
    expect(engine.config.render.sketchy).toBe(true); // DEFAULT_CONFIG.render.sketchy, must survive
    expect(engine.config.render.padding).toBe(40);
  });
});
