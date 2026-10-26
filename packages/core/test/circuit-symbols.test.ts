import { describe, it, expect } from 'vitest';
import { SYMBOLS, SYMBOL_VARIANTS, symbolFor, orient } from '../src/circuit/symbols.js';

const ctx = { stroke: '#000', fill: '#fff', strokeWidth: 1.6, text: '#000' };

describe('circuit symbol artwork', () => {
  const all = [...Object.values(SYMBOLS), ...Object.values(SYMBOL_VARIANTS), symbolFor('X', ['in+', 'in-', 'out', 'vcc', 'vee']), symbolFor('X', ['a', 'b', 'c'])];
  it('pins sit on the 10px grid and inside the box', () => {
    for (const d of all) for (const p of d.pins) {
      expect(p.x % 10, `${d.kind}.${p.name} x`).toBe(0);
      expect(p.y % 10, `${d.kind}.${p.name} y`).toBe(0);
      expect(p.x >= 0 && p.x <= d.width && p.y >= 0 && p.y <= d.height).toBe(true);
    }
  });
  it('draws plain SVG and survives orientation', () => {
    for (const d of all) {
      expect(d.draw(ctx)).toMatch(/<(path|line|rect)/);
      const o = orient(d, 90, true);
      expect(o.pins).toHaveLength(d.pins.length);
    }
  });
  it('picks variants by model type', () => {
    const pins = ['C', 'B', 'E'];
    expect(symbolFor('Q', pins, 'PNP')).toBe(SYMBOL_VARIANTS.PNP);
    expect(symbolFor('Q', pins, 'NPN')).toBe(SYMBOLS.Q);
    expect(symbolFor('D', ['anode', 'cathode'], '', 'LED')).toBe(SYMBOL_VARIANTS.LED);
    expect(symbolFor('X', ['inp', 'inn', 'out']).pins.map((p) => p.name)).toEqual(['inp', 'inn', 'out']);
  });
});
