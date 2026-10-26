import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseKicadPcb, parseSExp, boardBounds } from '../src/pcb/kicad-pcb.js';
import { createEngine } from '../src/index.js';
import { parseDSL } from '../src/parser/parser.js';

const board = readFileSync(new URL('./fixtures/pcb/blinky.kicad_pcb', import.meta.url), 'utf8');

describe('kicad_pcb parser', () => {
  it('parses s-expressions with quoted strings', () => {
    expect(parseSExp('(a "b c" (d 1))')).toEqual(['a', 'b c', ['d', '1']]);
  });
  const b = parseKicadPcb(board);
  it('reads outline, footprints, tracks, vias, nets', () => {
    expect(boardBounds(b)).toEqual({ x: 100, y: 100, w: 30, h: 20 });
    expect(b.footprints.map((f) => f.ref)).toEqual(['R1', 'R2', 'D1', 'J1']);
    expect(b.tracks).toHaveLength(4);
    expect(b.tracks[0]).toMatchObject({ layer: 'F.Cu', width: 0.4, net: 'VCC' });
    expect(b.vias).toEqual([{ x: 108, y: 112.8, size: 0.8, drill: 0.4 }]);
  });
  it('reads pads incl. shape, drill and layers', () => {
    const j1 = b.footprints[3];
    expect(j1.pads.map((p) => [p.shape, p.drill])).toEqual([['rect', 1], ['circle', 1]]);
    expect(j1.pads[0].layers).toContain('*.Cu');
    expect(b.footprints[0].pads[0]).toMatchObject({ type: 'smd', shape: 'roundrect', w: 1, h: 1.4, x: -1 });
    expect(b.footprints[0].lines).toHaveLength(2);
    expect(b.footprints[2].circles[0].r).toBeCloseTo(1.4);
  });
});

describe('pcb render', () => {
  const src = (head: string) => `pcb "Blinky" {\n${head}${board}\n}`;
  it('parses through the DSL entry as a raw body', () => {
    const r = parseDSL(src(''));
    expect(r.ok && (r.value as any).type).toBe('pcb');
  });
  const eng = createEngine();
  const svgOf = (t: string) => { const r = eng.compileSync(src(t)); expect(r.ok).toBe(true); return r.ok ? r.value.svg : ''; };
  it('renders precise SVG with refdes, drills and layer colours', () => {
    const s = svgOf('');
    expect(s).toContain('>R1<'); expect(s).toContain('>J1<');
    expect(s).toContain('#c83434');   // F.Cu
    expect(s).toContain('#4aa65a');   // B.Cu
    expect(s).toContain('#06100b');   // drills
  });
  it('side: back mirrors the board', () => {
    expect(svgOf('side: back\n')).not.toBe(svgOf(''));
  });
});
