import { describe, it, expect } from 'vitest';
import { wallDimensionStrings, clearGap, formatLength } from '../src/floorplan/dimensions.js';
import type { FpWallSeg } from '../src/floorplan/dimensions.js';

const SCALE = 60; // px per metre, matching layoutFloorplan's FP_SCALE

/** Walls for one rectangular room spanning (x,y)-(x+w,y+h) in metres. */
function boxWalls(x: number, y: number, w: number, h: number, kind: FpWallSeg['kind'] = 'exterior'): FpWallSeg[] {
  const s = SCALE;
  const [x1, y1, x2, y2] = [x * s, y * s, (x + w) * s, (y + h) * s];
  return [
    { x1, y1, x2, y2: y1, kind },       // north
    { x1, y1: y2, x2, y2, kind },       // south
    { x1, y1, x2: x1, y2, kind },       // west
    { x1: x2, y1, x2, y2, kind },       // east
  ];
}

describe('wallDimensionStrings', () => {
  it('dimensions a simple rectangle once per axis, not once per side', () => {
    const dims = wallDimensionStrings(boxWalls(0, 0, 4, 3), SCALE);
    // The bottom repeats the top and the right repeats the left, so only the
    // near face of each pair survives: two strings, not four.
    expect(dims).toHaveLength(2);
    expect(dims.every((d) => d.chain === 0)).toBe(true);
    expect(dims.map((d) => d.side).sort()).toEqual(['left', 'top']);
    expect(dims.find((d) => d.side === 'top')!.text).toBe('4.00 m');
    expect(dims.find((d) => d.side === 'left')!.text).toBe('3.00 m');
  });

  it('keeps the opposite facade when its divisions differ', () => {
    // Top facade splits 4+6; the bottom is one 10m run behind a single room,
    // so it says something the top does not and must be kept.
    const walls: FpWallSeg[] = [
      ...boxWalls(0, 0, 4, 3), ...boxWalls(4, 0, 6, 3),
      ...boxWalls(0, 3, 10, 2),
    ];
    const dims = wallDimensionStrings(walls, SCALE);
    expect(dims.some((d) => d.side === 'bottom')).toBe(true);
    expect(dims.filter((d) => d.side === 'bottom' && d.chain === 0).map((d) => d.text)).toEqual(['10.00 m']);
  });

  it('never places a dimension inside the building envelope', () => {
    const walls = boxWalls(0, 0, 4, 3);
    const dims = wallDimensionStrings(walls, SCALE);
    const minX = Math.min(...walls.flatMap((w) => [w.x1, w.x2]));
    const maxX = Math.max(...walls.flatMap((w) => [w.x1, w.x2]));
    const minY = Math.min(...walls.flatMap((w) => [w.y1, w.y2]));
    const maxY = Math.max(...walls.flatMap((w) => [w.y1, w.y2]));
    for (const d of dims) {
      const outside = d.side === 'top' ? d.y1 < minY
        : d.side === 'bottom' ? d.y1 > maxY
        : d.side === 'left' ? d.x1 < minX
        : d.x1 > maxX;
      expect(outside, `${d.side} string at ${d.x1},${d.y1} is not outside`).toBe(true);
    }
  });

  it('breaks a shared facade into one run per room, plus an overall string', () => {
    // Two rooms side by side: 4m + 6m along the top facade.
    const walls = [...boxWalls(0, 0, 4, 3), ...boxWalls(4, 0, 6, 3)];
    const dims = wallDimensionStrings(walls, SCALE);
    const top = dims.filter((d) => d.side === 'top');
    const detail = top.filter((d) => d.chain === 0).map((d) => d.text).sort();
    expect(detail).toEqual(['4.00 m', '6.00 m']);
    // The overall extent goes on its own chain, further out than the detail.
    const overall = top.filter((d) => d.chain === 1);
    expect(overall).toHaveLength(1);
    expect(overall[0].text).toBe('10.00 m');
    expect(overall[0].overall).toBe(true);
    expect(overall[0].y1).toBeLessThan(detail.length ? top.find((d) => d.chain === 0)!.y1 : 0);
  });

  it('measures each wall length only once across the whole drawing', () => {
    const walls = [...boxWalls(0, 0, 4, 3), ...boxWalls(4, 0, 6, 3)];
    const dims = wallDimensionStrings(walls, SCALE);
    // Every detail string on a given side must cover a distinct span — no two
    // strings may report the same run.
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      const spans = dims.filter((d) => d.side === side && d.chain === 0)
        .map((d) => (side === 'top' || side === 'bottom' ? [d.x1, d.x2] : [d.y1, d.y2]).join(':'));
      expect(new Set(spans).size).toBe(spans.length);
    }
  });

  it('ignores walls that step back from the facade on an L-shaped plan', () => {
    // L-shape: the 4x3 room's east wall at x=4 is exterior but set back from
    // the building's x=10 facade, so the right-hand face must not dimension it.
    const walls = [
      ...boxWalls(0, 0, 10, 3),
      ...boxWalls(0, 3, 4, 5),
    ];
    const dims = wallDimensionStrings(walls, SCALE);
    const right = dims.filter((d) => d.side === 'right');
    // The right facade only exists for the top band (y 0..3).
    expect(right.every((d) => d.x1 >= 10 * SCALE)).toBe(true);
    expect(right.map((d) => d.text)).toEqual(['3.00 m']);
  });

  it('honours a face whose runs are collinear but separated', () => {
    const dims = wallDimensionStrings(boxWalls(0, 0, 4, 3), SCALE, { offset: 10, chainGap: 10 });
    const top = dims.find((d) => d.side === 'top')!;
    expect(top.y1).toBe(-10); // offset applied outward from y=0
  });
});

describe('formatLength', () => {
  it('uses centimetres below a metre and metres above', () => {
    expect(formatLength(0.9)).toBe('90 cm');
    expect(formatLength(1)).toBe('1.00 m');
    expect(formatLength(4.5)).toBe('4.50 m');
  });
});

describe('clearGap', () => {
  it('measures the horizontal clear distance between two boxes', () => {
    const g = clearGap({ x: 0, y: 0, w: 10, h: 10 }, { x: 30, y: 0, w: 10, h: 10 })!;
    expect(g.px).toBe(20);
    expect(g.x1).toBe(10);
    expect(g.x2).toBe(30);
    expect(g.y1).toBe(g.y2); // a horizontal measurement stays level
  });

  it('measures the vertical clear distance when boxes are stacked', () => {
    const g = clearGap({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 25, w: 10, h: 10 })!;
    expect(g.px).toBe(15);
    expect(g.x1).toBe(g.x2);
  });

  it('runs the measurement through the two boxes shared overlap band', () => {
    // Overlapping y range is 5..10, so the line should sit at y=7.5.
    const g = clearGap({ x: 0, y: 0, w: 10, h: 10 }, { x: 30, y: 5, w: 10, h: 10 })!;
    expect(g.y1).toBe(7.5);
  });

  it('measures a zero gap between touching boxes', () => {
    const g = clearGap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })!;
    expect(g.px).toBe(0);
  });

  it('returns undefined for boxes that overlap on both axes', () => {
    expect(clearGap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBeUndefined();
  });

  it('measures to a zero-thickness box, which is how a wall reference resolves', () => {
    // `Living.north` becomes a flat box; the gap to it must still work.
    const wall = { x: 0, y: 0, w: 100, h: 0 };
    const g = clearGap(wall, { x: 20, y: 40, w: 10, h: 10 })!;
    expect(g.px).toBe(40);
  });
});
