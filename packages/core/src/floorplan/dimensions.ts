// =============================================================================
// SelDiA — Floorplan Dimensioning
// =============================================================================
// Everything that turns wall/room/furniture geometry into *measured* annotation:
// the automatic exterior wall-length strings, and the explicit `measure`
// statements an author writes for object-to-object / wall-to-object gaps.
//
// The rules encoded here are ordinary architectural drafting convention, and
// the two that drive the whole design are:
//
//   1. A wall length is dimensioned ONCE. A plan that repeats the same run on
//      two sides of the sheet (or on both the inside and outside face of the
//      same wall) reads as two conflicting measurements, not as helpfulness.
//      `wallDimensionStrings` therefore projects every exterior wall run onto
//      its outward side, merges collinear touching runs into single spans, and
//      drops any span already covered by another on the same side.
//   2. Dimensions live OUTSIDE the building envelope. Interior walls get no
//      automatic dimension at all — the only place to put that text is inside
//      a room, on top of the furniture. Authors who genuinely need an interior
//      measurement ask for it explicitly with `measure`.
//
// Strings are stacked outward in "chains": chain 0 sits closest to the building
// and carries the individual wall runs, chain 1 carries the single overall
// building extent. That inner-detail/outer-total ordering is the convention
// every drafting standard shares (ISO 129, ANSI Y14.5), and it's also what
// keeps the two from colliding.
// =============================================================================

/** A wall segment in pixel space, as derived by layoutFloorplan. */
export interface FpWallSeg {
  x1: number; y1: number; x2: number; y2: number;
  kind: 'exterior' | 'interior';
}

/** Which outward face of the building a dimension string is pinned to. */
export type DimSide = 'top' | 'bottom' | 'left' | 'right';

/** One dimension: a measured span drawn as an offset line with tick marks at
 *  each end, extension lines back to the geometry, and the measurement text
 *  centred on it. `chain` stacks strings outward from the building. */
export interface FpDimension {
  /** Endpoints of the dimension line itself, already offset off the building. */
  x1: number; y1: number; x2: number; y2: number;
  /** Where the extension lines start (the geometry being measured). */
  ex1: number; ey1: number; ex2: number; ey2: number;
  /** Pre-formatted measurement text, e.g. "4.00 m". */
  text: string;
  side: DimSide;
  /** 0 = nearest the building, higher = further out. */
  chain: number;
  /** Overall-extent strings render slightly heavier than the detail chain. */
  overall?: boolean;
}

/** An author-declared `measure` between two entities, resolved to pixels. */
export interface FpMeasure {
  x1: number; y1: number; x2: number; y2: number;
  text: string;
  /** Drawn with a leader/witness style distinct from the wall-length strings. */
  kind: 'measure';
}

const EPS = 0.5; // px; collinearity + touch tolerance

/** Metres → the label a drafter would actually write. Sub-metre spans read
 *  better in centimetres (a 900 mm door is "90 cm", not "0.90 m"). */
export function formatLength(metres: number): string {
  if (metres < 1) return `${Math.round(metres * 100)} cm`;
  return `${metres.toFixed(2)} m`;
}

/** Merge touching/overlapping 1-D spans into the fewest covering spans. */
function mergeSpans(spans: [number, number][]): [number, number][] {
  if (!spans.length) return [];
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [[sorted[0][0], sorted[0][1]]];
  for (const [lo, hi] of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (lo <= last[1] + EPS) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

/**
 * Split contiguous spans at the given break points.
 *
 * This is what makes the detail chain say something useful. Exterior walls
 * arrive as one run per room, and consecutive rooms' runs touch end to end, so
 * merging alone collapses a whole facade into a single overall figure —
 * technically correct but it tells a builder nothing about where the internal
 * partitions land. Breaking the merged run at every partition intersection
 * gives the room-by-room string that a plan is actually dimensioned with.
 */
function splitAt(spans: [number, number][], breaks: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const [lo, hi] of spans) {
    // Two rooms meeting at a partition each contribute a wall at the same
    // coordinate, so the break list routinely holds duplicates. Splitting on
    // both would emit a zero-length span between them — a "0 cm" dimension.
    // Sorting and then skipping any break within EPS of the running cursor
    // dedupes on tolerance rather than exact equality, which matters because
    // two rooms' wall coordinates can differ in the last floating-point bit.
    const inner = breaks.filter((b) => b > lo + EPS && b < hi - EPS).sort((a, b) => a - b);
    let cursor = lo;
    for (const b of inner) {
      if (b - cursor <= EPS) continue;
      out.push([cursor, b]);
      cursor = b;
    }
    if (hi - cursor > EPS) out.push([cursor, hi]);
  }
  return out;
}

/**
 * The automatic exterior wall dimensions.
 *
 * Every exterior wall run is projected onto whichever building face it belongs
 * to (a horizontal run at the topmost Y is a "top" wall, at the bottom-most Y a
 * "bottom" wall, and so on). Runs that only touch a face's extreme coordinate
 * partially — an L-shaped plan's stepped edges — are kept on the face nearest
 * them, so a step still gets measured rather than silently dropped.
 *
 * Rule 1 above is enforced twice over: collinear runs on the same face are
 * merged into single spans before any string is emitted, and a face whose
 * merged detail is a single span skips the redundant overall string (measuring
 * the same run twice is exactly the duplication we're avoiding).
 */
export function wallDimensionStrings(
  walls: FpWallSeg[],
  scale: number,
  opts: { offset?: number; chainGap?: number } = {},
): FpDimension[] {
  const exterior = walls.filter((w) => w.kind === 'exterior');
  if (!exterior.length) return [];

  const offset = opts.offset ?? 34;
  const chainGap = opts.chainGap ?? 30;

  // Building envelope, from every wall (interior included — an interior wall
  // never lies outside the envelope, but using all of them is cheap and makes
  // the bounds robust to a plan whose outer ring isn't fully closed).
  const xs = walls.flatMap((w) => [w.x1, w.x2]);
  const ys = walls.flatMap((w) => [w.y1, w.y2]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  // Bucket each exterior run onto a face — but ONLY the runs lying on that
  // face's outermost line.
  //
  // An L-shaped plan has exterior walls that step back from the envelope (the
  // short return at the inside of the L). Those are genuinely exterior, but
  // they are not on the facade, and dimensioning them automatically produces
  // exactly what rule 1 forbids: a second string on the same side measuring a
  // different line, which reads as a contradiction rather than as detail. A
  // step is already implied by the perpendicular faces' chains, and anything
  // more specific is what an explicit `measure` is for.
  const onLine = (v: number, target: number) => Math.abs(v - target) <= EPS;
  const faces: Record<DimSide, { span: [number, number]; at: number }[]> = { top: [], bottom: [], left: [], right: [] };
  for (const w of exterior) {
    const horizontal = Math.abs(w.y2 - w.y1) < EPS;
    if (horizontal) {
      const side: DimSide | undefined = onLine(w.y1, minY) ? 'top' : onLine(w.y1, maxY) ? 'bottom' : undefined;
      if (!side) continue;
      const lo = Math.min(w.x1, w.x2), hi = Math.max(w.x1, w.x2);
      if (hi - lo > EPS) faces[side].push({ span: [lo, hi], at: w.y1 });
    } else if (Math.abs(w.x2 - w.x1) < EPS) {
      const side: DimSide | undefined = onLine(w.x1, minX) ? 'left' : onLine(w.x1, maxX) ? 'right' : undefined;
      if (!side) continue;
      const lo = Math.min(w.y1, w.y2), hi = Math.max(w.y1, w.y2);
      if (hi - lo > EPS) faces[side].push({ span: [lo, hi], at: w.x1 });
    }
  }

  const dims: FpDimension[] = [];

  /**
   * Break points for one face: the partitions that actually LAND on it.
   *
   * A partition deep inside the plan (the Bathroom's far wall, say) shares an
   * axis coordinate with the facade but never touches it, and breaking the
   * facade string there invents a division a builder cannot see on that wall.
   * So a wall only breaks a face when one of its endpoints reaches that
   * face's line — which is exactly the set of walls meeting it.
   */
  const breaksFor = (side: DimSide, base: number): number[] => {
    const horizontalFace = side === 'top' || side === 'bottom';
    const out: number[] = [];
    for (const w of walls) {
      if (horizontalFace) {
        // A vertical wall breaks a horizontal face if it reaches that face's Y.
        if (Math.abs(w.x2 - w.x1) >= EPS) continue;
        if (Math.min(w.y1, w.y2) <= base + EPS && Math.max(w.y1, w.y2) >= base - EPS) out.push(w.x1);
      } else {
        if (Math.abs(w.y2 - w.y1) >= EPS) continue;
        if (Math.min(w.x1, w.x2) <= base + EPS && Math.max(w.x1, w.x2) >= base - EPS) out.push(w.y1);
      }
    }
    return out;
  };

  // Resolve every face's spans up front, so opposite faces can be compared
  // before anything is emitted.
  const resolved = new Map<DimSide, { base: number; spans: [number, number][] }>();
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const runs = faces[side];
    if (!runs.length) continue;
    // The face's baseline. Every run bucketed onto this face already lies on
    // the same outermost line, so they all share one `at`.
    const base = runs[0].at;
    resolved.set(side, {
      base,
      // Detail spans: the facade merged into continuous runs, then divided at
      // the partitions that actually meet it.
      spans: splitAt(mergeSpans(runs.map((r) => r.span)), breaksFor(side, base)),
    });
  }

  // Rule 1, at the level of whole facades. On a plain rectangular plan the
  // bottom facade repeats the top's divisions exactly, and the right repeats
  // the left's — dimensioning both states every length twice. Keep the near
  // face (top / left, where a reader looks first) and drop the far one when
  // its spans are identical. They stay when they differ, which is the case
  // that carries information: a plan whose partitions don't line up.
  const sameSpans = (a: [number, number][], b: [number, number][]) =>
    a.length === b.length && a.every(([lo, hi], i) => Math.abs(lo - b[i][0]) <= EPS && Math.abs(hi - b[i][1]) <= EPS);
  for (const [near, far] of [['top', 'bottom'], ['left', 'right']] as const) {
    const n = resolved.get(near), f = resolved.get(far);
    if (n && f && sameSpans(n.spans, f.spans)) resolved.delete(far);
  }

  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const entry = resolved.get(side);
    if (!entry) continue;
    const { base, spans: merged } = entry;
    const runs = faces[side];

    const lineAt = (chain: number): number => {
      const d = offset + chain * chainGap;
      return side === 'top' ? base - d : side === 'bottom' ? base + d
        : side === 'left' ? base - d : base + d;
    };

    const push = (lo: number, hi: number, chain: number, overall: boolean, at: number) => {
      const pos = lineAt(chain);
      const horizontal = side === 'top' || side === 'bottom';
      dims.push({
        x1: horizontal ? lo : pos, y1: horizontal ? pos : lo,
        x2: horizontal ? hi : pos, y2: horizontal ? pos : hi,
        ex1: horizontal ? lo : at, ey1: horizontal ? at : lo,
        ex2: horizontal ? hi : at, ey2: horizontal ? at : hi,
        text: formatLength(Math.abs(hi - lo) / scale),
        side, chain, overall,
      });
    };

    // Chain 0: the individual wall runs.
    for (const [lo, hi] of merged) {
      const owner = runs.find((r) => r.span[0] >= lo - EPS && r.span[1] <= hi + EPS);
      push(lo, hi, 0, false, owner?.at ?? base);
    }

    // Chain 1: the overall extent — but only when it would say something the
    // detail chain doesn't. A face that split into exactly one run already IS
    // its own overall length, and repeating it is the duplication rule 1
    // exists to prevent.
    if (merged.length > 1) {
      const lo = Math.min(...merged.map((m) => m[0]));
      const hi = Math.max(...merged.map((m) => m[1]));
      push(lo, hi, 1, true, base);
    }
  }

  return dims;
}

/** Axis-aligned box, the shape every measurable floorplan entity reduces to. */
export interface FpBox { x: number; y: number; w: number; h: number }

/**
 * The clear gap between two boxes, as a drafter would measure it: along
 * whichever axis the two are actually separated, from facing edge to facing
 * edge. Boxes that overlap on both axes have no meaningful clear distance and
 * return undefined rather than a zero-length dimension.
 *
 * The returned segment is centred on the two boxes' shared overlap band so the
 * measurement line runs *between* them instead of clipping a corner.
 */
export function clearGap(a: FpBox, b: FpBox): { x1: number; y1: number; x2: number; y2: number; px: number } | undefined {
  const ax2 = a.x + a.w, ay2 = a.y + a.h;
  const bx2 = b.x + b.w, by2 = b.y + b.h;

  const gapX = b.x - ax2 >= 0 ? b.x - ax2 : (a.x - bx2 >= 0 ? a.x - bx2 : -1);
  const gapY = b.y - ay2 >= 0 ? b.y - ay2 : (a.y - by2 >= 0 ? a.y - by2 : -1);

  // Prefer the axis on which they're genuinely separated. When separated on
  // both (diagonal neighbours) take the larger gap — that's the dimension a
  // drafter means by "distance between these two".
  const useX = gapX >= 0 && (gapY < 0 || gapX >= gapY);
  const useY = gapY >= 0 && !useX;
  if (!useX && !useY) return undefined;

  if (useX) {
    const lo = Math.max(a.y, b.y), hi = Math.min(ay2, by2);
    const y = hi > lo ? (lo + hi) / 2 : (a.y + ay2 + b.y + by2) / 4;
    const [x1, x2] = b.x - ax2 >= 0 ? [ax2, b.x] : [bx2, a.x];
    return { x1, y1: y, x2, y2: y, px: Math.abs(x2 - x1) };
  }
  const lo = Math.max(a.x, b.x), hi = Math.min(ax2, bx2);
  const x = hi > lo ? (lo + hi) / 2 : (a.x + ax2 + b.x + bx2) / 4;
  const [y1, y2] = b.y - ay2 >= 0 ? [ay2, b.y] : [by2, a.y];
  return { x1: x, y1, x2: x, y2, px: Math.abs(y2 - y1) };
}
