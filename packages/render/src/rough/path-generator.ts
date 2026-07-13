// =============================================================================
// SelDiA — Rough Path Generator
// =============================================================================
// Generates SVG path data with hand-drawn "rough" wobble, mimicking Rough.js
// output without requiring DOM APIs. Works in both Node.js and browser.
//
// Rough.js generates paths by adding random offsets to points and using
// multiple overlapping strokes. We do the same here with a seeded random
// so diagrams are deterministic for the same input.

// ---------------------------------------------------------------------------
// Seeded Random (deterministic wobble)
// ---------------------------------------------------------------------------

export class SeededRandom {
  private seed: number;

  constructor(seed: number = 42) {
    this.seed = seed;
  }

  /** Returns a value in [0, 1) */
  next(): number {
    this.seed = (this.seed * 16807 + 0) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  /** Returns a value in [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

// ---------------------------------------------------------------------------
// Rough Path Options
// ---------------------------------------------------------------------------

export interface RoughOptions {
  roughness: number;   // 0 (smooth) to 3 (very rough)
  bowing: number;      // 0 (straight) to 5 (bowed)
  strokeWidth: number;
}

// ---------------------------------------------------------------------------
// Rough drawn path from a set of points
// ---------------------------------------------------------------------------

export interface RoughPath {
  /** SVG path data string */
  d: string;
  /** CSS stroke color */
  stroke: string;
  /** Stroke width */
  strokeWidth: number;
  /** Fill color or 'none' */
  fill: string;
  /** Opacity */
  opacity: number;
}

// ---------------------------------------------------------------------------
// Core: Apply wobble to a point
// ---------------------------------------------------------------------------

function wobble(
  x: number, y: number,
  roughness: number,
  bowing: number,
  rng: SeededRandom,
): [number, number] {
  const ox = rng.range(-roughness * 2, roughness * 2) + rng.range(-bowing, bowing);
  const oy = rng.range(-roughness * 2, roughness * 2) + rng.range(-bowing, bowing);
  return [x + ox, y + oy];
}

// ---------------------------------------------------------------------------
// Generate a rough rectangle path
// ---------------------------------------------------------------------------

export function roughRectangle(
  x: number, y: number, w: number, h: number,
  rng: SeededRandom,
  opts: RoughOptions,
): string {
  const { roughness, bowing } = opts;
  const r = Math.min(rng.range(roughness * 1.5, roughness * 3), 12);

  // Define 4 corners
  const corners: [number, number][] = [
    wobble(x + r, y, roughness, bowing, rng),       // top-left
    wobble(x + w - r, y, roughness, bowing, rng),    // top-right
    wobble(x + w, y + r, roughness, bowing, rng),    // top-right (corner)
    wobble(x + w, y + h - r, roughness, bowing, rng),// bottom-right (corner)
    wobble(x + w - r, y + h, roughness, bowing, rng),// bottom-right
    wobble(x + r, y + h, roughness, bowing, rng),    // bottom-left
    wobble(x, y + h - r, roughness, bowing, rng),    // bottom-left (corner)
    wobble(x, y + r, roughness, bowing, rng),        // top-left (corner)
  ];

  // Build a rough rectangle with rounded corners
  let d = `M ${corners[0][0]} ${corners[0][1]}`;
  d += ` Q ${(corners[0][0] + corners[1][0]) / 2} ${(corners[0][1] + corners[1][1]) / 2} ${corners[1][0]} ${corners[1][1]}`;
  d += ` Q ${(corners[1][0] + corners[2][0]) / 2} ${(corners[1][1] + corners[2][1]) / 2} ${corners[2][0]} ${corners[2][1]}`;
  d += ` L ${corners[3][0]} ${corners[3][1]}`;
  d += ` Q ${(corners[3][0] + corners[4][0]) / 2} ${(corners[3][1] + corners[4][1]) / 2} ${corners[4][0]} ${corners[4][1]}`;
  d += ` Q ${(corners[4][0] + corners[5][0]) / 2} ${(corners[4][1] + corners[5][1]) / 2} ${corners[5][0]} ${corners[5][1]}`;
  d += ` L ${corners[6][0]} ${corners[6][1]}`;
  d += ` Q ${(corners[6][0] + corners[7][0]) / 2} ${(corners[6][1] + corners[7][1]) / 2} ${corners[7][0]} ${corners[7][1]}`;
  d += ` Z`;

  return d;
}

// ---------------------------------------------------------------------------
// Generate a rough polygon (diamond, hexagon, parallelogram)
// ---------------------------------------------------------------------------

export function roughPolygon(
  points: [number, number][],
  rng: SeededRandom,
  opts: RoughOptions,
): string {
  const { roughness, bowing } = opts;
  if (points.length < 2) return '';

  const wobbled = points.map(p => wobble(p[0], p[1], roughness, bowing, rng));
  let d = `M ${wobbled[0][0]} ${wobbled[0][1]}`;
  for (let i = 1; i < wobbled.length; i++) {
    d += ` L ${wobbled[i][0]} ${wobbled[i][1]}`;
  }
  d += ' Z';
  return d;
}

// ---------------------------------------------------------------------------
// Generate a rough ellipse/circle
// ---------------------------------------------------------------------------

export function roughEllipse(
  cx: number, cy: number, rx: number, ry: number,
  rng: SeededRandom,
  opts: RoughOptions,
): string {
  const { roughness, bowing } = opts;
  const steps = 24;
  const pts: [number, number][] = [];

  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const px = cx + rx * Math.cos(angle);
    const py = cy + ry * Math.sin(angle);
    const [wx, wy] = wobble(px, py, roughness, bowing, rng);
    pts.push([wx, wy]);
  }

  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const mx = (prev[0] + curr[0]) / 2;
    const my = (prev[1] + curr[1]) / 2;
    d += ` Q ${prev[0]},${prev[1]} ${mx},${my}`;
  }
  d += ' Z';
  return d;
}

// ---------------------------------------------------------------------------
// Generate a rough line/polyline
// ---------------------------------------------------------------------------

export function roughPolyline(
  points: [number, number][],
  rng: SeededRandom,
  opts: RoughOptions,
): string {
  const { roughness, bowing } = opts;
  if (points.length < 2) return '';

  const wobbled = points.map(p => wobble(p[0], p[1], roughness, bowing, rng));
  let d = `M ${wobbled[0][0]} ${wobbled[0][1]}`;
  for (let i = 1; i < wobbled.length; i++) {
    d += ` L ${wobbled[i][0]} ${wobbled[i][1]}`;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Generate a rough arc (for cylinder ends)
// ---------------------------------------------------------------------------

export function roughArc(
  cx: number, cy: number, rx: number,
  startAngle: number, endAngle: number,
  rng: SeededRandom,
  opts: RoughOptions,
): string {
  const { roughness, bowing } = opts;
  const steps = 12;
  const pts: [number, number][] = [];

  for (let i = 0; i <= steps; i++) {
    const t = startAngle + (i / steps) * (endAngle - startAngle);
    const px = cx + rx * Math.cos(t);
    const py = cy + rx * Math.sin(t);
    const [wx, wy] = wobble(px, py, roughness, bowing, rng);
    pts.push([wx, wy]);
  }

  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i][0]} ${pts[i][1]}`;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Double stroke: generate a second overlapping stroke with offset
// ---------------------------------------------------------------------------

export function doubleStroke(
  generator: () => string,
  rng: SeededRandom,
): [string, string] {
  const main = generator();
  // Slight offset for the second stroke
  const offset = rng.range(-1.5, 1.5);
  return [main, generator()]; // In practice we return same generator result
}

// ---------------------------------------------------------------------------
// Generate overlaid rough strokes (Rough.js-style multi-stroke)
// ---------------------------------------------------------------------------

export function generateRoughPaths(
  shapeType: string,
  params: {
    x?: number; y?: number; w?: number; h?: number;
    cx?: number; cy?: number; rx?: number; ry?: number;
    points?: [number, number][];
  },
  roughness: number,
  strokeWidth: number,
  fillMode: boolean,
  seed: number = 42,
): string[] {
  const rng = new SeededRandom(seed);
  const opts: RoughOptions = { roughness, bowing: Math.min(roughness * 1.2, 5), strokeWidth };
  const strokes: string[] = [];

  // Number of overlapping strokes increases with roughness
  const numStrokes = roughness > 1.5 ? 2 : 1;

  for (let s = 0; s < numStrokes; s++) {
    let path = '';
    switch (shapeType) {
      case 'rectangle':
        if (params.x !== undefined && params.y !== undefined && params.w && params.h) {
          path = roughRectangle(params.x, params.y, params.w, params.h, rng, opts);
        }
        break;
      case 'ellipse':
        if (params.cx !== undefined && params.cy !== undefined && params.rx && params.ry) {
          path = roughEllipse(params.cx, params.cy, params.rx, params.ry, rng, opts);
        }
        break;
      case 'polygon':
        if (params.points) {
          path = roughPolygon(params.points, rng, opts);
        }
        break;
      case 'polyline':
        if (params.points) {
          path = roughPolyline(params.points, rng, opts);
        }
        break;
    }
    if (path) strokes.push(path);
  }

  return strokes;
}
