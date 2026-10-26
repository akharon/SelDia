import { describe, it, expect } from 'vitest';
import { chipSize, chipRect, computeEdgeLabelPositions, EDGE_LABEL_FONT } from '../src/render/edge-label-placement.js';
import { measureLabel, textWidth } from '../src/layout/text-measure.js';
import { balancedWrap, shapeTextBox, iconLabelLayout, sizeForShape } from '../src/render/node-label-geometry.js';
import { DS } from '../src/render/design-system.js';
import type { IREdge, IRGroup, IRNode } from '../src/ir/types.js';

const node = (id: string, x: number, y: number, w = 80, h = 40, extra: Record<string, unknown> = {}): IRNode =>
  ({ id, label: id, shape: 'rectangle', position: { x, y }, size: { width: w, height: h }, data: {}, ...extra }) as unknown as IRNode;
const edge = (id: string, label: string, wps: Array<[number, number]>): IREdge =>
  ({ id, sourceId: 'a', targetId: 'b', label, waypoints: wps.map(([x, y]) => ({ x, y })) }) as unknown as IREdge;
const byId = (...ns: IRNode[]) => new Map(ns.map((n) => [n.id, n]));
const overlap = (a: any, b: any) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

describe('text measure + chip size', () => {
  it('capitals and digits are wider than narrow lowercase', () => {
    expect(textWidth('WWWW', 12)).toBeGreaterThan(textWidth('iiii', 12) * 2);
    expect(textWidth('ABC', 12)).toBeGreaterThan(textWidth('abc', 12));
    expect(textWidth('0123', 12)).toBeGreaterThan(textWidth('iiii', 12));
  });
  it('typical text averages about 0.56em per character', () => {
    const w = textWidth('Process request data', 12) / 'Process request data'.length / 12;
    expect(w).toBeGreaterThan(0.45);
    expect(w).toBeLessThan(0.62);
  });
  it('chipSize is the measured label plus DS.chip padding, and chipRect is centred on it', () => {
    const m = measureLabel('Hello', EDGE_LABEL_FONT);
    const s = chipSize('Hello');
    expect(EDGE_LABEL_FONT).toBe(DS.fontSize.meta);
    expect(s.w).toBe(Math.ceil(m.width + 2 * DS.chip.padX));
    expect(s.h).toBe(m.height + 2 * DS.chip.padY);
    const r = chipRect(100, 50, 'Hello');
    expect([r.x + r.width / 2, r.y + r.height / 2]).toEqual([100, 50]);
    expect(chipSize('a much longer label').w).toBeGreaterThan(s.w);
  });
});

describe('edge label placement', () => {
  it('centres the chip ON the longest horizontal segment', () => {
    const a = node('a', 0, 0), b = node('b', 300, 0);
    const e = edge('e', 'go', [[80, 20], [300, 20]]);
    const p = computeEdgeLabelPositions([e], byId(a, b), 0).get('e')!;
    expect(p.y).toBe(20);
    expect(p.x).toBeGreaterThan(80);
    expect(p.x).toBeLessThan(300);
    expect(p.leader).toBeUndefined();
  });

  it('centres the chip ON a vertical segment too (same look as horizontals)', () => {
    const a = node('a', 0, 0), b = node('b', 0, 300);
    const e = edge('e', 'No', [[40, 40], [40, 300]]);
    e.layoutLabel = { x: 60, y: 170 } as any; // ELK's beside-the-line spot must not win
    const p = computeEdgeLabelPositions([e], byId(a, b), 0).get('e')!;
    expect(p.x).toBe(40);
    expect(p.y).toBeGreaterThan(40);
    expect(p.y).toBeLessThan(300);
    expect(p.leader).toBeUndefined();
  });

  it('keeps the chip out of the arrowhead zone and the source zone', () => {
    const a = node('a', 0, 0), b = node('b', 120, 0);
    // A short straight edge: the midpoint chip would cover the last 14px.
    const e = edge('e', 'a long label here', [[80, 20], [120, 20]]);
    const p = computeEdgeLabelPositions([e], byId(a, b), 0).get('e')!;
    const r = chipRect(p.x, p.y, 'a long label here');
    const zones = [{ x: 106, y: 19, width: 14, height: 2 }, { x: 80, y: 19, width: 8, height: 2 }];
    for (const z of zones) expect(overlap(r, z)).toBe(false);
  });

  it('prefers a clean offset spot to sitting on the arrowhead (above a horizontal)', () => {
    const e = edge('e', 'x', [[0, 100], [200, 100]]);
    const other = edge('o', 'y', [[0, 100], [200, 100]]); // identical route: centre spot taken by the other chip
    const m = computeEdgeLabelPositions([e, other], new Map(), 0);
    const r1 = chipRect(m.get('e')!.x, m.get('e')!.y, 'x'), r2 = chipRect(m.get('o')!.x, m.get('o')!.y, 'y');
    expect(overlap(r1, r2)).toBe(false);
  });

  it('never lands on a group title band', () => {
    const g = { id: 'g', label: 'G', position: { x: 0, y: 0 }, size: { width: 400, height: 200 }, childNodeIds: [], childGroupIds: [] } as unknown as IRGroup;
    // Edge runs right through the band (y=15): the chip must leave it.
    const e = edge('e', 'lbl', [[20, 15], [380, 15], [380, 150]]);
    const p = computeEdgeLabelPositions([e], new Map(), 0, [g]).get('e')!;
    const r = chipRect(p.x, p.y, 'lbl');
    expect(overlap(r, { x: 0, y: 0, width: 400, height: 30 })).toBe(false);
  });

  it('draws a leader when the chip had to move more than 16px from its edge', () => {
    // A tiny edge wedged between two nodes whose boxes cover every on-edge spot.
    const a = node('a', 0, 0, 100, 100), b = node('b', 130, 0, 100, 100);
    const e = edge('e', 'wide label that cannot fit', [[100, 50], [130, 50]]);
    const p = computeEdgeLabelPositions([e], byId(a, b), 0).get('e')!;
    const r = chipRect(p.x, p.y, 'wide label that cannot fit');
    expect(overlap(r, { x: 0, y: 0, width: 100, height: 100 })).toBe(false);
    expect(overlap(r, { x: 130, y: 0, width: 100, height: 100 })).toBe(false);
    expect(p.leader).toBeDefined();
    expect(p.leader!.from.x).toBeGreaterThanOrEqual(100);
    expect(p.leader!.from.x).toBeLessThanOrEqual(130);
  });
});

describe('node label geometry', () => {
  it('balancedWrap minimises the longest line without a ragged last word', () => {
    const greedy = balancedWrap('alpha beta gamma delta', 100, 11);
    expect(greedy.length).toBe(2);
    expect(greedy.join(' ')).toBe('alpha beta gamma delta');
    const w = greedy.map((l) => textWidth(l, 11));
    expect(Math.abs(w[0] - w[1])).toBeLessThan(textWidth('alpha ', 11));
    expect(balancedWrap('a b c', 1000, 11)).toEqual(['a b c']);
    expect(balancedWrap('supercalifragilistic word', 20, 11)).toEqual(['supercalifragilistic', 'word']);
    expect(balancedWrap('one two\nthree', 1000, 11)).toEqual(['one two', 'three']);
  });
  it('shape text boxes sit inside the outline', () => {
    const mk = (shape: string) => node('n', 0, 0, 120, 80, { shape });
    const d = shapeTextBox(mk('diamond'));
    expect([d.width, d.height]).toEqual([60, 40]);
    const c = shapeTextBox(mk('cylinder'));
    expect(c.y).toBe(24);
    expect(c.y + c.height).toBe(56);
    const e = shapeTextBox(mk('circle'));
    expect(e.width).toBeCloseTo(120 / Math.SQRT2);
    const h = shapeTextBox(mk('hexagon'));
    expect(h.width).toBeLessThan(120);
    expect(shapeTextBox(mk('rectangle')).width).toBe(120);
  });
  it('network labels sit below the icon', () => {
    const n = node('srv', 0, 0, 60, 60, { data: { networkKind: 'server' } });
    const L = iconLabelLayout(n)!;
    expect(L.anchor).toBe('middle');
    expect(L.box.y).toBeGreaterThanOrEqual(60);
  });
});

describe('shape sizing', () => {
  const inner = (label: string, shape: string) => {
    const sz = sizeForShape(label, shape, 14, 100, 50);
    const n = node('n', 0, 0, sz.width, sz.height, { shape });
    const box = shapeTextBox(n);
    const lines = balancedWrap(label, Math.max(20, box.width - 8), 14);
    const tw = Math.max(...lines.map((l) => textWidth(l, 14)));
    return { sz, box, tw, th: lines.length * Math.round(14 * 1.35) };
  };
  it('a diamond fits "Smoke tests OK?" and "Tests pass?" inside its inscribed box', () => {
    for (const l of ['Smoke tests OK?', 'Tests pass?']) {
      const { sz, box, tw, th } = inner(l, 'diamond');
      expect(tw).toBeLessThanOrEqual(box.width);
      expect(th).toBeLessThanOrEqual(box.height);
      expect(sz.width % 4).toBe(0);
      expect(sz.height % 4).toBe(0);
      expect(sz.width).toBeLessThanOrEqual(2 * sz.height);
    }
    expect(inner('Tests pass?', 'diamond').th).toBe(Math.round(14 * 1.35)); // one line, not needlessly wrapped
  });
  it('hexagon, ellipse and cylinder fit their text box; sizing is deterministic', () => {
    for (const shape of ['hexagon', 'circle', 'cylinder']) {
      const { box, tw, th } = inner('Deploy to production cluster', shape);
      expect(tw).toBeLessThanOrEqual(box.width);
      expect(th).toBeLessThanOrEqual(box.height);
    }
    expect(sizeForShape('Smoke tests OK?', 'diamond', 14, 100, 50)).toEqual(sizeForShape('Smoke tests OK?', 'diamond', 14, 100, 50));
  });
  it('rectangles keep the legacy size', () => {
    expect(sizeForShape('Hi', 'rectangle', 14, 100, 50)).toEqual({ width: 100, height: 50 });
  });
});
