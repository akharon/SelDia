import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine.js';
import { readableTextOn, contrastOf } from '../src/render/design-system.js';
import { balancedWrap, shapeTextBox } from '../src/render/node-label-geometry.js';

const svgOf = (src: string): string => {
  const r = createEngine().compileSync(src);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('compile failed');
  return r.value.svg;
};

describe('T1 cylinder labels', () => {
  it('maps [(...)] to the database cylinder and wraps the label', () => {
    const r = createEngine().compileSync('fl "C" { a [Start]\n db [(Customer orders database primary replica)]\n a -> db }');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const db: any = (r.value as any).ir?.nodes?.find((n: any) => n.id === 'db');
    const svg = r.value.svg;
    if (db) expect(String(db.shape)).toBe('cylinder');
    expect(svg).toContain('Customer orders');
    expect(svg).not.toContain('Customer orders database primary replica</tspan>');
  });
  it('wraps long component datastore and C4 database labels', () => {
    expect(svgOf('component "C" { database db "Customer orders database primary replica store" }')).not.toContain('>Customer orders database primary replica store<');
    expect(svgOf('c4c "C" { database db "Customer orders database primary replica" "d" }')).not.toContain('>Customer orders database primary replica<');
  });
  it('shapeTextBox for a cylinder stays within its body', () => {
    const n: any = { position: { x: 0, y: 0 }, size: { width: 160, height: 100 }, shape: 'cylinder', label: 'x' };
    expect(shapeTextBox(n).width).toBeLessThanOrEqual(160);
    expect(balancedWrap('aaa bbb ccc ddd eee', 60, 14).length).toBeGreaterThan(1);
  });
});

describe('T2 sankey flow labels', () => {
  it('keeps every flow value discoverable and labels do not stack', () => {
    const svg = svgOf('sankey "E" {\n a "A"\n b "B"\n g "G"\n a -> g: "110"\n a -> b: "10"\n b -> g: "75"\n}');
    for (const v of ['110', '10', '75']) expect(svg).toContain(`: ${v}</title>`);
    const byX = new Map<string, number[]>();
    for (const m of svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" text-anchor="middle"[^>]*>(\d+)</g)) byX.set(m[1], [...(byX.get(m[1]) ?? []), Number(m[2])]);
    for (const ys of byX.values()) { ys.sort((a, b) => a - b); for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(13); }
  });
});

describe('T3 sequence self-message', () => {
  it('draws the label right of the loop, inside the lane gap', () => {
    const svg = svgOf('seq "S" {\n a "A"\n b "B"\n a -> a: "validate the password and token"\n a -> b: "go"\n}');
    const x = (re: RegExp) => Number(re.exec(svg)![1]);
    const labelX = x(/<text x="([\d.]+)" y="[\d.]+" text-anchor="start"[^>]*>validate/);
    expect(labelX).toBeGreaterThan(80);
    const w = x(/viewBox="0 0 ([\d.]+)/);
    expect(labelX + 'validate the password and token'.length * 6).toBeLessThan(w);
  });
});

describe('T4 readable text', () => {
  it('readableTextOn reaches WCAG 4.5 or picks the best of dark/white', () => {
    for (const fill of ['#6366f1', '#0d9488', '#f59e0b', '#ffffff', '#000000', '#818cf8']) {
      const t = readableTextOn(fill, '#888888');
      const best = Math.max(contrastOf('#ffffff', fill), contrastOf('#1f2933', fill));
      expect(contrastOf(t, fill)).toBeGreaterThanOrEqual(Math.min(4.5, best) - 0.01);
    }
    expect(readableTextOn('#fff', '#111111')).toBe('#111111');
    expect(readableTextOn('not-a-colour', '#123456')).toBe('#123456');
  });
  it('mindmap edges start on the shape boundary, not at the centre', () => {
    const r = createEngine().compileSync('mind "M" { root "Root"\n a "Alpha"\n root -> a }');
    expect(r.ok).toBe(true);
  });
});

describe('T4 text on fills', () => {
  it('form submit and cloud badge text meet 4.5:1 where reachable', () => {
    const svg = svgOf('form "F" {\n [Name: text, required]\n submit "Go"\n}');
    expect(svg).not.toContain('fill="#ffffff" font-size="14"  font-weight="600">Go');
  });
});

describe('T4 palette contrast', () => {
  it('readableTextOn falls back to near-black when neither DS dark nor white reach 4.5', () => {
    for (const fill of ['#807aec', '#16a34a', '#e0458a', '#ff6666']) expect(contrastOf(readableTextOn(fill, '#ffffff'), fill)).toBeGreaterThanOrEqual(4.5);
  });
  it('mermaid style fill without color gets readable text', () => {
    const svg = svgOf('fl "C" { a [Hello]\n b [World]\n a -> b }');
    expect(svg).toContain('Hello');
  });
});

describe('T2 sankey chips never intersect', () => {
  it.each([['demo-basic.md#25'], ['demo-mermaid.md#17']])('%s', async (key) => {
    const { extractFences } = await import('../../../scripts/layout-metrics-lib.mjs');
    const core = await import('../src/index.js');
    const f = extractFences(new URL('../../../docs/examples', import.meta.url).pathname, (l: string) => core.fenceToSource(l, '') !== null).find((x: any) => x.key === key)!;
    const { kind, source } = core.fenceToSource(f.lang, f.code)!;
    const eng = core.createEngine({});
    let ir: any;
    if (kind === 'seldia') ir = eng.transform(eng.analyze(eng.parse(source).value as any).value as any).value;
    else ir = (kind === 'mermaid' ? core.importMermaid(source) : core.importPlantUml(source)).ir;
    const svg = eng.render((await eng.layoutAsync(ir)).value as any).value.svg as string;
    const rects = [...svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"[^>]*fill="#ffffff" fill-opacity="0.92"/g)].map((m) => m.slice(1).map(Number));
    expect(rects.length).toBeGreaterThan(2);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const [ax, ay, aw, ah] = rects[i], [bx, by, bw, bh] = rects[j];
      expect(ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by, `${i}/${j}`).toBe(false);
    }
  });
});
