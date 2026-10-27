// =============================================================================
// SelDiA — Edge layer: nudge, line jumps and clean-edge path geometry
// =============================================================================
// Pure functions over the ROUTED waypoints (layout coordinates, no padding).
// engine.ts runs `postRoute` between routing and label placement, and
// layout/metrics.ts calls the same function so it measures what is drawn.
//
//   nudgeRoutes  separates collinear runs shared by different edges onto
//                parallel tracks, keeping every endpoint on its port, and
//                reverts any edge whose nudge would cut into a node.
//   unhugRoutes  pushes a run that travels along a node border (within HUG_DIST
//                for more than HUG_MIN) off it by DS.portStub; a run touching
//                a port slides the port along its node or grows a stub.
//   avoidBands   moves a vertical run that strikes through a group title chip
//                to just outside the title text (end runs slide along the port
//                side of their node).
//   findJumps    where a later edge crosses an earlier one at a right angle,
//                records a hop on the later edge's segment (horizontal hops
//                bulge up, vertical hops bulge right).
//   edgePathD    SVG path data: rounded orthogonal bends plus the hops.
// =============================================================================

import type { Point, Rect } from '../types/common.js';
import { snapApexes } from './edge-routing.js';
import type { DiagramIR, IRNode } from '../ir/types.js';
import type { IRGroup } from '../ir/types.js';
import { DS } from './design-system.js';
import { textWidth } from '../layout/text-measure.js';

/** Overlap (px) above which two collinear runs count as a shared run. */
export const NUDGE_MIN_OVERLAP = 8;
/** Track spacing for separated runs (px). */
export const NUDGE_STEP = 6;
/** Radius of a line-jump hop (px). */
export const HOP_RADIUS = 5;
/** Crossings closer than this to a bend or endpoint get no hop (px). */
export const HOP_MARGIN = 10;

/** A hop over a crossing: `at` is the crossing's x on a horizontal segment, or
 *  its y when `vert` is set (hop on a vertical segment). */
/** Diagram types whose edges are orthogonal graph edges between nodes: the only
 *  ones nudge / hops / title-band avoidance may touch. Everything else (sankey
 *  ribbons, charts, timeline, gantt, git lanes, sequence, circuits...) owns its
 *  edge geometry. Shared by engine.ts and layout/metrics.ts. */
export const POST_ROUTE_TYPES: ReadonlySet<string> = new Set([
  'flowchart', 'class', 'er', 'state', 'usecase', 'activity', 'component', 'deployment',
  'c4-context', 'c4-container', 'c4-component', 'c4-code', 'bpmn', 'dmn', 'network', 'block', 'cloud', 'workitem',
]);

export interface Hop { seg: number; at: number; vert?: boolean; }
export type Routes = Map<string, Point[]>;
export interface PostRouted { routes: Routes; jumps: Map<string, Hop[]>; }

const TOL = 0.75;
const isH = (a: Point, b: Point) => Math.abs(a.y - b.y) < TOL && Math.abs(a.x - b.x) >= TOL;
const isV = (a: Point, b: Point) => Math.abs(a.x - b.x) < TOL && Math.abs(a.y - b.y) >= TOL;

// ── Nudge ───────────────────────────────────────────────────────────────────

interface Run {
  id: string; seg: number; coord: number; lo: number; hi: number;
  /** Side (-1 toward smaller perpendicular coordinate, +1 larger, 0 none) the route
   *  leaves this run on at its lo end and at its hi end. */
  loDir: number; hiDir: number;
}

function collectRuns(routes: Routes, horizontal: boolean): Run[] {
  const runs: Run[] = [];
  for (const [id, pts] of routes) {
    // Segments touching a port stay put: moving them would detach the edge.
    for (let i = 1; i < pts.length - 2; i++) {
      const a = pts[i], b = pts[i + 1];
      if (horizontal ? !isH(a, b) : !isV(a, b)) continue;
      const prev = pts[i - 1], next = pts[i + 2];
      const perp = (p: Point) => { const d = horizontal ? p.y - a.y : p.x - a.x; return Math.abs(d) < TOL ? 0 : Math.sign(d); };
      const aIsLo = horizontal ? a.x < b.x : a.y < b.y;
      const loDir = perp(aIsLo ? prev : next), hiDir = perp(aIsLo ? next : prev);
      runs.push(horizontal
        ? { id, seg: i, coord: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), loDir, hiDir }
        : { id, seg: i, coord: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), loDir, hiDir });
    }
  }
  return runs;
}

function nodeHits(pts: Point[], nodes: IRNode[]): number {
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    for (const nd of nodes) {
      const rx = nd.position.x + 1.5, ry = nd.position.y + 1.5;
      const rw = nd.size.width - 3, rh = nd.size.height - 3;
      if (x1 > rx && x0 < rx + rw && y1 > ry && y0 < ry + rh) { n++; break; }
    }
  }
  return n;
}

/** Same turn directions as before, so a nudge never folds a route back on itself. */
function sameDirections(before: Point[], after: Point[]): boolean {
  for (let i = 0; i < before.length - 1; i++) {
    const dx0 = before[i + 1].x - before[i].x, dy0 = before[i + 1].y - before[i].y;
    const dx1 = after[i + 1].x - after[i].x, dy1 = after[i + 1].y - after[i].y;
    if (Math.abs(dx0) >= TOL && dx0 * dx1 < 1) return false;
    if (Math.abs(dy0) >= TOL && dy0 * dy1 < 1) return false;
  }
  return true;
}

/** Crossings forced when edge X's runs take the lower track and Y's the higher
 *  one: a connector of X leaving toward higher tracks (or of Y toward lower)
 *  strictly inside the other's span must cut across it. */
function channelCost(xs: Run[], ys: Run[]): number {
  let c = 0;
  const hit = (r: Run, other: Run, dir: number, at: number, want: number) =>
    dir === want && at >= other.lo - 0.5 && at <= other.hi + 0.5 ? 1 : 0;
  for (const x of xs) for (const y of ys) {
    c += hit(x, y, x.loDir, x.lo, 1) + hit(x, y, x.hiDir, x.hi, 1);
    c += hit(y, x, y.loDir, y.lo, -1) + hit(y, x, y.hiDir, y.hi, -1);
  }
  return c;
}

/** Track order for the edges sharing one channel (lowest track first): the
 *  classic rule for parallel orthogonal segments, comparing each pair by the
 *  crossings their next / previous bend directions would force. Ties fall back
 *  to the sorted id order, so the result is deterministic. */
function orderChannel(ids: string[], comp: Run[], keyOf: (id: string) => string): string[] {
  const runsOf = new Map(ids.map((k) => [k, comp.filter((r) => keyOf(r.id) === k)]));
  return [...ids].sort((a, b) => {
    const d = channelCost(runsOf.get(a)!, runsOf.get(b)!) - channelCost(runsOf.get(b)!, runsOf.get(a)!);
    return d || (a < b ? -1 : a > b ? 1 : 0);
  });
}

/** Separate collinear overlapping runs of different edges onto parallel
 *  tracks. Returns new routes (inputs are not mutated). */
export function nudgeRoutes(routes: Routes, nodes: IRNode[] = [], nets?: Map<string, string>): Routes {
  // `nets` (circuits): edges of one net may overlap; only different nets are
  // separated, and runs touching a route end (a pin) never move.
  const keyOf = (id: string) => nets?.get(id) ?? id;
  const shifts = new Map<string, Point[]>();
  for (const [id, pts] of routes) shifts.set(id, pts.map(() => ({ x: 0, y: 0 })));

  for (const horizontal of [true, false]) {
    const runs = collectRuns(routes, horizontal).sort((a, b) => a.coord - b.coord || (a.id < b.id ? -1 : a.id > b.id ? 1 : a.seg - b.seg));
    // Cluster runs lying on (almost) the same line.
    let i = 0;
    while (i < runs.length) {
      let j = i + 1;
      while (j < runs.length && runs[j].coord - runs[j - 1].coord < 1) j++;
      const cluster = runs.slice(i, j);
      i = j;
      if (cluster.length < 2) continue;
      // Union runs of different edges that overlap by more than the threshold.
      const parent = cluster.map((_, k) => k);
      const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
      for (let a = 0; a < cluster.length; a++) {
        for (let b = a + 1; b < cluster.length; b++) {
          if (cluster[a].id === cluster[b].id) continue;
          const ov = Math.min(cluster[a].hi, cluster[b].hi) - Math.max(cluster[a].lo, cluster[b].lo);
          if (ov > NUDGE_MIN_OVERLAP) parent[find(a)] = find(b);
        }
      }
      const comps = new Map<number, Run[]>();
      cluster.forEach((r, k) => { const root = find(k); (comps.get(root) ?? comps.set(root, []).get(root)!).push(r); });
      for (const comp of comps.values()) {
        const ids = [...new Set(comp.map((r) => keyOf(r.id)))].sort();
        if (ids.length < 2) continue;
        const step = ids.length === 2 ? NUDGE_STEP * 2 : NUDGE_STEP;
        const pinned = (r: Run) => !!nets && (r.seg === 0 || r.seg + 2 >= routes.get(r.id)!.length);
        const offs = new Map<string, number>();
        if (nets) {
          // Pin-touching runs stay put; the rest take tracks around them.
          const fixedKeys = ids.filter((k) => comp.some((r) => keyOf(r.id) === k && pinned(r)));
          const tracks: number[] = [0];
          for (let t = 1; tracks.length < ids.length; t++) tracks.push(t * step, -t * step);
          fixedKeys.forEach((k) => offs.set(k, 0));
          const free = tracks.filter((t) => t !== 0 || fixedKeys.length === 0);
          ids.filter((k) => !offs.has(k)).forEach((k, n) => offs.set(k, free[n] ?? 0));
        } else orderChannel(ids, comp, keyOf).forEach((k, n) => offs.set(k, (n - (ids.length - 1) / 2) * step));
        for (const r of comp) {
          if (pinned(r)) continue;
          const off = offs.get(keyOf(r.id))!;
          const sh = shifts.get(r.id)!;
          for (const k of [r.seg, r.seg + 1]) { if (horizontal) sh[k].y = off; else sh[k].x = off; }
        }
      }
    }
  }

  const out: Routes = new Map();
  for (const [id, pts] of routes) {
    const sh = shifts.get(id)!;
    if (!sh.some((s) => s.x !== 0 || s.y !== 0)) { out.set(id, pts); continue; }
    const moved = pts.map((p, k) => ({ x: p.x + sh[k].x, y: p.y + sh[k].y }));
    // Revert when the nudge folds the route back or newly cuts into a node.
    const ok = sameDirections(pts, moved) && nodeHits(moved, nodes) <= nodeHits(pts, nodes);
    out.set(id, ok ? moved : pts);
  }
  return out;
}

// ── Border hugs ─────────────────────────────────────────────────────────────

/** A run closer than this to a node's side counts as hugging it (matches the metric). */
export const HUG_DIST = 4;
/** ...when it runs along the side for more than this many px. */
export const HUG_MIN = 12;

/** Length of axis-aligned segment a-b running along a side of rect r within HUG_DIST. */
function hugLen(a: Point, b: Point, r: Rect): number {
  if (Math.abs(a.y - b.y) < 0.5) {
    if (![r.y, r.y + r.height].some((y) => Math.abs(a.y - y) <= HUG_DIST)) return 0;
    return Math.max(0, Math.min(Math.max(a.x, b.x), r.x + r.width) - Math.max(Math.min(a.x, b.x), r.x));
  }
  if (Math.abs(a.x - b.x) < 0.5) {
    if (![r.x, r.x + r.width].some((x) => Math.abs(a.x - x) <= HUG_DIST)) return 0;
    return Math.max(0, Math.min(Math.max(a.y, b.y), r.y + r.height) - Math.max(Math.min(a.y, b.y), r.y));
  }
  return 0;
}

const nodeBox = (n: IRNode): Rect => ({ x: n.position.x, y: n.position.y, width: n.size.width, height: n.size.height });

function hugTotal(pts: Point[], nodes: IRNode[]): number {
  let t = 0;
  for (let i = 0; i < pts.length - 1; i++) for (const n of nodes) if (hugLen(pts[i], pts[i + 1], nodeBox(n)) > HUG_MIN) t++;
  return t;
}

/** Fix the first hugging run of a route; returns the new points, or null when none (or no safe fix). */
function unhugOnce(pts: Point[], nodes: IRNode[]): Point[] | null {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const vert = Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5;
    const horiz = Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5;
    if (!vert && !horiz) continue;
    for (const n of nodes) {
      const r = nodeBox(n);
      if (hugLen(a, b, r) <= HUG_MIN) continue;
      // Push away from the node centre, to portStub beyond the nearest side.
      const lo = vert ? r.x : r.y, hi = vert ? r.x + r.width : r.y + r.height;
      const c = vert ? a.x : a.y;
      const side = Math.abs(c - lo) <= Math.abs(c - hi) ? lo : hi;
      const target = side + (side === lo ? -DS.portStub : DS.portStub);
      const set = (p: Point, v: number): Point => (vert ? { x: v, y: p.y } : { x: p.x, y: v });
      const out: Point[] = [];
      pts.forEach((p, k) => {
        if (k !== i && k !== i + 1) { out.push(p); return; }
        const isEnd = k === 0 || k === pts.length - 1;
        if (!isEnd) { out.push(set(p, target)); return; }
        // A port: slide along its own node when it stays on that node's side, else grow a stub.
        const own = nodeAtEnd(p, nodes);
        const o = own && own !== n ? nodeBox(own) : undefined;
        const slideOk = o && (vert
          ? target >= o.x + PORT_INSET && target <= o.x + o.width - PORT_INSET
          : target >= o.y + PORT_INSET && target <= o.y + o.height - PORT_INSET);
        if (slideOk) { out.push(set(p, target)); return; }
        if (k === 0) out.push(p, set(p, target)); else out.push(set(p, target), p);
      });
      if (nodeHits(out, nodes) > nodeHits(pts, nodes) || hugTotal(out, nodes) >= hugTotal(pts, nodes)) continue;
      return out;
    }
  }
  return null;
}

/** Push runs that travel along a node border off it by DS.portStub. */
export function unhugRoutes(routes: Routes, nodes: IRNode[] = []): Routes {
  if (!nodes.length) return routes;
  const out: Routes = new Map();
  for (const [id, pts] of routes) {
    let cur = pts;
    for (let pass = 0; pass < 4; pass++) {
      const next = unhugOnce(cur, nodes);
      if (!next) break;
      cur = next;
    }
    out.set(id, cur);
  }
  return out;
}

// ── Line jumps ──────────────────────────────────────────────────────────────

/** Hops for every crossing where a later edge (deterministic id order) cuts an
 *  earlier edge at a right angle; the hop sits on the later edge's horizontal
 *  segment. Crossings within HOP_MARGIN of a bend or endpoint are skipped. */
export function findJumps(routes: Routes, nets?: Map<string, string>): Map<string, Hop[]> {
  const ids = [...routes.keys()].sort();
  const jumps = new Map<string, Hop[]>();
  for (let bi = 1; bi < ids.length; bi++) {
    const later = routes.get(ids[bi])!;
    for (let s = 0; s < later.length - 1; s++) {
      const a = later[s], b = later[s + 1];
      const horiz = isH(a, b);
      if (!horiz && !isV(a, b)) continue;
      // Along-axis extent of the later segment and its fixed cross coordinate.
      const lo = horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y), hi = horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
      const cross = horiz ? a.y : a.x;
      if (hi - lo < HOP_MARGIN * 2) continue;
      // Circuits: a segment ending at a route end (pin / junction) never hops.
      if (nets && (s === 0 || s === later.length - 2)) continue;
      for (let ai = 0; ai < bi; ai++) {
        if (nets && nets.get(ids[ai]) === nets.get(ids[bi])) continue;
        const earlier = routes.get(ids[ai])!;
        for (let t = 0; t < earlier.length - 1; t++) {
          const c = earlier[t], d = earlier[t + 1];
          if (horiz ? !isV(c, d) : !isH(c, d)) continue;
          const at = horiz ? c.x : c.y;
          const e0 = horiz ? Math.min(c.y, d.y) : Math.min(c.x, d.x), e1 = horiz ? Math.max(c.y, d.y) : Math.max(c.x, d.x);
          if (at < lo + HOP_MARGIN || at > hi - HOP_MARGIN) continue;
          if (cross < e0 + HOP_MARGIN || cross > e1 - HOP_MARGIN) continue;
          const list = jumps.get(ids[bi]) ?? jumps.set(ids[bi], []).get(ids[bi])!;
          if (list.some((h) => h.seg === s && Math.abs(h.at - at) < HOP_MARGIN)) continue;
          list.push(horiz ? { seg: s, at } : { seg: s, at, vert: true });
        }
      }
    }
  }
  for (const list of jumps.values()) list.sort((p, q) => p.seg - q.seg || p.at - q.at);
  return jumps;
}

// ── Title-band avoidance ────────────────────────────────────────────────────

/** Clear space (px) kept between a moved run and the band edge. */
const BAND_CLEAR = 6;
/** Inset (px) from a node's side corners a moved end point must keep. */
const PORT_INSET = 8;

const nodeShapeIsBox = (n: IRNode) => !['diamond', 'circle', 'ellipse', 'hexagon', 'parallelogram', 'stadium'].includes(String(n.shape));
const rectsOverlapV = (x: number, y0: number, y1: number, r: Rect) =>
  x > r.x && x < r.x + r.width && Math.max(y0, y1) > r.y && Math.min(y0, y1) < r.y + r.height;

/** The node whose border carries route end point `p` (box-shaped nodes only). */
function nodeAtEnd(p: Point, nodes: IRNode[]): IRNode | undefined {
  return nodes.find((n) => nodeShapeIsBox(n)
    && p.x >= n.position.x - 6 && p.x <= n.position.x + n.size.width + 6
    && p.y >= n.position.y - 6 && p.y <= n.position.y + n.size.height + 6);
}

/** Move vertical runs that cross a title band (a group's title chip, layout
 *  coordinates) to just outside the band's x extent. Interior runs move with
 *  their two bends; a run touching a port moves the port too, along its node's
 *  top/bottom side, only while it stays inside the node. A move that would
 *  fold the route, cut a node or hit another band is dropped. */
export function avoidBands(routes: Routes, bands: Rect[], nodes: IRNode[] = []): Routes {
  if (!bands.length) return routes;
  const out: Routes = new Map();
  for (const [id, pts0] of routes) {
    let pts = pts0;
    for (let guard = 0; guard < 4; guard++) {
      let moved: Point[] | undefined;
      for (let i = 0; i < pts.length - 1 && !moved; i++) {
        const a = pts[i], b = pts[i + 1];
        if (!isV(a, b)) continue;
        const band = bands.find((r) => rectsOverlapV(a.x, a.y, b.y, r));
        if (!band) continue;
        const cands = [band.x - BAND_CLEAR, band.x + band.width + BAND_CLEAR]
          .sort((p, q) => Math.abs(p - a.x) - Math.abs(q - a.x));
        const touchStart = i === 0, touchEnd = i + 1 === pts.length - 1;
        for (const nx of cands) {
          const q = pts.map((p) => ({ ...p }));
          let ok = true;
          for (const [k, touch] of [[i, touchStart], [i + 1, touchEnd]] as const) {
            if (touch) {
              const nd = nodeAtEnd(pts[k], nodes);
              if (!nd || nx < nd.position.x + PORT_INSET || nx > nd.position.x + nd.size.width - PORT_INSET) ok = false;
            }
            q[k].x = nx;
          }
          if (!ok) continue;
          // A two-point route with both ends moved stays straight; otherwise the
          // neighbouring segments must stay horizontal-ish and unfolded.
          if (!sameDirections(pts, q) && pts.length > 2) continue;
          if (nodeHits(q, nodes) > nodeHits(pts, nodes)) continue;
          if (bands.some((r) => rectsOverlapV(nx, a.y, b.y, r))) continue;
          moved = q; break;
        }
      }
      if (!moved) break;
      pts = moved;
    }
    out.set(id, pts);
  }
  return out;
}

/** Rewrite a route whose last leg enters a T/B side as `Q A B P` (vertical, horizontal,
 *  vertical) so it enters the node's L/R side instead: `Q C P'`, one bend fewer. */
function zEndToSide(r: Point[], n: IRNode, slot: (side: 'L' | 'R') => number = () => 0.5): { pts: Point[]; side: 'L' | 'R' } | null {
  const k = r.length;
  if (k < 4) return null;
  const [Q, A, B, P] = [r[k - 4], r[k - 3], r[k - 2], r[k - 1]];
  if (!(isV(Q, A) && isH(A, B) && isV(B, P))) return null;
  const left = n.position.x, right = n.position.x + n.size.width;
  if (A.x > left - 8 && A.x < right + 8) return null;
  const side = A.x < left ? 'L' : 'R';
  // Each end moved to a side takes its own slot, so none lands on another's pin.
  const ym = n.position.y + n.size.height * slot(side);
  if ((ym - Q.y) * (A.y - Q.y) <= 0 || Math.abs(ym - Q.y) < MIN_STUB) return null;
  return { pts: [...r.slice(0, k - 3), { x: A.x, y: ym }, { x: side === 'L' ? left : right, y: ym }], side };
}

function relieveCrowdedSides(routes: Routes, nodes: IRNode[], groups: Map<string, End[]>): Routes | null {
  const need = DS.portStub * 1.5;
  const count = new Map<string, number>();
  for (const [key, list] of groups) count.set(key, list.length);
  let out: Routes | null = null;
  for (const [key, list] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const n = list[0].node, side = list[0].side;
    const span = side === 'T' || side === 'B' ? n.size.width : n.size.height;
    let k = list.length;
    if (k < 2 || (k <= MAX_PER_SIDE && span / (k + 1) >= need)) continue;
    // Outermost turners first (largest |rank|, then the far key).
    for (const e of [...list].filter((x) => x.rank !== 0).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (k <= MAX_PER_SIDE && span / (k + 1) >= need) break;
      const cur = (out ?? routes).get(e.id)!;
      const r = e.end ? cur : [...cur].reverse();
      let moved: { pts: Point[]; side: 'L' | 'R' | 'T' | 'B' } | null;
      // Fraction along the destination side for the next end moved there.
      const slotOf = (sd: string) => { const c = (count.get(`${n.id}:${sd}`) ?? 0) + 1; return c / (c + 1); };
      if (side === 'T' || side === 'B') moved = zEndToSide(r, n, (sd) => slotOf(sd));
      else {
        const sw = (p: Point): Point => ({ x: p.y, y: p.x });
        const sn = { ...n, position: sw(n.position), size: { width: n.size.height, height: n.size.width } } as IRNode;
        const m = zEndToSide(r.map(sw), sn, (sd) => slotOf(sd === 'L' ? 'T' : 'B'));
        moved = m ? { pts: m.pts.map(sw), side: m.side === 'L' ? 'T' : 'B' } : null;
      }
      if (!moved) continue;
      const destKey = `${n.id}:${moved.side}`;
      const destSpan = moved.side === 'T' || moved.side === 'B' ? n.size.width : n.size.height;
      const destK = (count.get(destKey) ?? 0) + 1;
      if (destSpan / (destK + 1) < need) continue;
      const q = e.end ? moved.pts : [...moved.pts].reverse();
      if (nodeHits(q, nodes) > nodeHits(cur, nodes) || hugTotal(q, nodes) > hugTotal(cur, nodes)) continue;
      const rr: Routes = out ?? new Map(routes);
      if (conflicts(e.id, q, rr) > conflicts(e.id, cur, rr)) continue;
      rr.set(e.id, q); out = rr;
      count.set(destKey, destK); k--; count.set(key, k);
    }
  }
  return out;
}

/** Port-order search limits: beyond these the rule order is used as is. */
const PERM_MAX_ROUTES = 150, PERM_MAX_WORK = 600;
/** Above this many routes the O(routes) per-candidate clean-ups (Z-jog removal, bend cap) are skipped. */
const CLEANUP_MAX_ROUTES = 200;
/** More ends than this on one node side count as crowded whatever the spacing. */
const MAX_PER_SIDE = 3;

// ── Port fanning ────────────────────────────────────────────────────────────

type Side = 'T' | 'B' | 'L' | 'R';
/** `rank`: which way the route turns after the port stub (-1 toward the lower side
 *  coordinate, 0 straight on, +1 higher); `len` the stub length; `key` the far
 *  coordinate used to break ties. */
interface End { id: string; end: 0 | 1; node: IRNode; side: Side; rank: number; len: number; key: number; }

/** Spread route ends that share one side of a box-shaped node: k ends sit at
 *  (i+1)/(k+1) of the side, ordered by the coordinate they approach from, so
 *  the parallel runs into the node never overlap and no new crossing appears.
 *  The last orthogonal segment is re-bent: its neighbour bend moves with the
 *  end. A route whose change would fold it or cut into a node keeps its old
 *  end. Ends alone on a side stay where they are. */
export function fanPorts(routes: Routes, nodes: IRNode[], relieved = false): Routes {
  const boxes = nodes.filter(nodeShapeIsBox);
  if (!boxes.length) return routes;
  const ends: End[] = [];
  for (const [id, pts] of routes) {
    if (pts.length < 2) continue;
    for (const end of [0, 1] as const) {
      const p = end ? pts[pts.length - 1] : pts[0], q = end ? pts[pts.length - 2] : pts[1];
      const far = end ? (pts[pts.length - 3] ?? pts[0]) : (pts[2] ?? pts[pts.length - 1]);
      let node: IRNode | undefined, side: Side | undefined, key = 0, rank = 0, len = 0;
      const other = end ? pts[0] : pts[pts.length - 1];
      if (isV(p, q)) {
        node = boxes.find((n) => p.x > n.position.x + 1 && p.x < n.position.x + n.size.width - 1
          && (Math.abs(p.y - n.position.y) < 5 || Math.abs(p.y - (n.position.y + n.size.height)) < 5));
        if (node) { side = Math.abs(p.y - node.position.y) < 5 ? 'T' : 'B'; len = Math.abs(p.y - q.y); const d = pts.length > 2 ? far.x - p.x : 0; rank = Math.abs(d) < TOL ? 0 : Math.sign(d); key = rank ? far.x : other.x; }
      } else if (isH(p, q)) {
        node = boxes.find((n) => p.y > n.position.y + 1 && p.y < n.position.y + n.size.height - 1
          && (Math.abs(p.x - n.position.x) < 5 || Math.abs(p.x - (n.position.x + n.size.width)) < 5));
        if (node) { side = Math.abs(p.x - node.position.x) < 5 ? 'L' : 'R'; len = Math.abs(p.x - q.x); const d = pts.length > 2 ? far.y - p.y : 0; rank = Math.abs(d) < TOL ? 0 : Math.sign(d); key = rank ? far.y : other.y; }
      }
      if (node && side) ends.push({ id, end, node, side, rank, len, key });
    }
  }
  const groups = new Map<string, End[]>();
  for (const e of ends) (groups.get(`${e.node.id}:${e.side}`) ?? groups.set(`${e.node.id}:${e.side}`, []).get(`${e.node.id}:${e.side}`)!).push(e);

  // A crowded side (ends closer than 1.5 port stubs even when evenly spread) gives
  // up its outermost Z-shaped ends to the adjacent side, where that removes a bend.
  if (!relieved) {
    const moved = relieveCrowdedSides(routes, nodes, groups);
    if (moved) return fanPorts(moved, nodes, true);
  }

  const next = new Map<string, Point[]>();
  const baseCost = new Map<string, { hits: number; hug: number }>();
  const get = (id: string) => (next.get(id) ?? routes.get(id)!).map((p) => ({ ...p }));
  /** What a route becomes with moved ends `q`: a straight two-point route whose
   *  ends no longer line up becomes a Z; a fold or a new node hit reverts it. */
  const accept = (id: string, q: Point[]): Point[] => {
    const pts = routes.get(id)!;
    if (q.length === 2 && (isV(pts[0], pts[1]) ? Math.abs(q[0].x - q[1].x) >= TOL : Math.abs(q[0].y - q[1].y) >= TOL)) {
      const vert = isV(pts[0], pts[1]);
      const m = vert ? (q[0].y + q[1].y) / 2 : (q[0].x + q[1].x) / 2;
      q = vert ? [q[0], { x: q[0].x, y: m }, { x: q[1].x, y: m }, q[1]] : [q[0], { x: m, y: q[0].y }, { x: m, y: q[1].y }, q[1]];
    }
    // Only the end segments move, so only they may differ from the original.
    const ok = q.length === pts.length ? sameDirections(pts, q) : true;
    if (!ok) return pts;
    let b = baseCost.get(id);
    if (!b) baseCost.set(id, b = { hits: nodeHits(pts, nodes), hug: hugTotal(pts, nodes) });
    return nodeHits(q, nodes) <= b.hits && hugTotal(q, nodes) <= b.hug ? q : pts;
  };
  const acceptCache = new Map<string, Point[]>();
  const acceptC = (id: string, q: Point[]): Point[] => {
    const key = id + '|' + q.map((p) => `${p.x},${p.y}`).join(';');
    let r = acceptCache.get(key);
    if (!r) acceptCache.set(key, r = accept(id, q));
    return r;
  };
  const place = (list: End[]): Map<string, Point[]> => {
    const n = list[0].node, side = list[0].side, k = list.length;
    const m = new Map<string, Point[]>();
    list.forEach((e, i) => {
      const t = (i + 1) / (k + 1);
      const pts = m.get(e.id) ?? get(e.id);
      const last = e.end ? pts.length - 1 : 0, adj = e.end ? pts.length - 2 : 1;
      if (side === 'T' || side === 'B') { const x = n.position.x + t * n.size.width; pts[last].x = x; pts[adj].x = x; }
      else { const y = n.position.y + t * n.size.height; pts[last].y = y; pts[adj].y = y; }
      m.set(e.id, pts);
    });
    return m;
  };
  const permutations = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])));
  for (const list of [...groups.values()].sort((a, b) => (a[0].node.id + a[0].side < b[0].node.id + b[0].side ? -1 : 1))) {
    if (list.length < 2) continue;
    // Turners toward the low side first (the earlier the turn, the lower the port),
    // straight-on ends in the middle (by destination), high-side turners last
    // (the later the turn, the lower the port): no two stubs then cross.
    list.sort((a, b) => a.rank - b.rank
      || (a.rank < 0 ? a.len - b.len : a.rank > 0 ? b.len - a.len : 0)
      || (Math.abs(a.key - b.key) < 1 ? 0 : a.key - b.key)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : a.end - b.end));
    // The rule above is the first candidate; small groups also try every other
    // order and keep the one with the fewest crossings / overlaps (first wins ties).
    let best = place(list);
    // Work cap: on big diagrams keep the rule order (the search is quadratic in routes).
    if (list.length <= 5 && routes.size <= PERM_MAX_ROUTES && list.length * routes.size <= PERM_MAX_WORK) {
      // Score only this group's own routes against the fixed others; the group's
      // entries are swapped into `merged` and restored per candidate.
      const merged: Routes = new Map(routes);
      for (const [id, q] of next) merged.set(id, acceptC(id, q));
      const saved = new Map([...new Set(list.map((e) => e.id))].map((id) => [id, merged.get(id)!]));
      const cost = (m: Map<string, Point[]>) => {
        for (const [id, q] of m) merged.set(id, acceptC(id, q));
        let c = 0;
        for (const id of m.keys()) c += conflicts(id, merged.get(id)!, merged) + (merged.get(id) === routes.get(id) ? 0.5 : 0);
        for (const [id, pts] of saved) merged.set(id, pts);
        return c;
      };
      let bestCost = cost(best);
      for (const order of permutations(list)) {
        if (bestCost === 0) break;
        const m = place(order), c = cost(m);
        if (c < bestCost) { best = m; bestCost = c; }
      }
    }
    for (const [id, q] of best) next.set(id, q);
  }
  const out: Routes = new Map();
  for (const [id, pts] of routes) {
    const q = next.get(id);
    out.set(id, q ? accept(id, q) : pts);
  }
  return out;
}

// ── Bend clean-up ───────────────────────────────────────────────────────────

/** Proper right-angle crossings of `pts` with every other route, plus collinear
 *  overlaps (> NUDGE_MIN_OVERLAP) with them. A candidate rewrite is accepted
 *  only when this does not grow. */
const bboxCache = new WeakMap<Point[], [number, number, number, number]>();
function bboxOf(pts: Point[]): [number, number, number, number] {
  let b = bboxCache.get(pts);
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of pts) { if (p.x < b[0]) b[0] = p.x; if (p.y < b[1]) b[1] = p.y; if (p.x > b[2]) b[2] = p.x; if (p.y > b[3]) b[3] = p.y; }
    bboxCache.set(pts, b);
  }
  return b;
}
function conflicts(id: string, pts: Point[], routes: Routes): number {
  let n = 0;
  const bb = bboxOf(pts);
  for (const [oid, q] of routes) {
    if (oid === id) continue;
    // Boxes more than 1px apart cannot cross or overlap.
    const ob = bboxOf(q);
    if (ob[0] > bb[2] + 1 || ob[2] < bb[0] - 1 || ob[1] > bb[3] + 1 || ob[3] < bb[1] - 1) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      for (let j = 0; j < q.length - 1; j++) {
        const c = q[j], d = q[j + 1];
        if (isH(a, b) && isV(c, d)) {
          if (c.x > Math.min(a.x, b.x) + TOL && c.x < Math.max(a.x, b.x) - TOL && a.y > Math.min(c.y, d.y) + TOL && a.y < Math.max(c.y, d.y) - TOL) n++;
        } else if (isV(a, b) && isH(c, d)) {
          if (a.x > Math.min(c.x, d.x) + TOL && a.x < Math.max(c.x, d.x) - TOL && c.y > Math.min(a.y, b.y) + TOL && c.y < Math.max(a.y, b.y) - TOL) n++;
        } else if (isH(a, b) && isH(c, d) && Math.abs(a.y - c.y) < 1) {
          if (Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > NUDGE_MIN_OVERLAP) n++;
        } else if (isV(a, b) && isV(c, d) && Math.abs(a.x - c.x) < 1) {
          if (Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > NUDGE_MIN_OVERLAP) n++;
        }
      }
    }
  }
  return n;
}

/** Cost tuple of a route for accept / reject comparisons. */
function routeCost(id: string, pts: Point[], routes: Routes, nodes: IRNode[]) {
  return { hits: nodeHits(pts, nodes), conf: conflicts(id, pts, routes), hug: hugTotal(pts, nodes) };
}
/** `routeCost(c)` no worse than `base`, with the cheap tests first and the O(routes)
 *  conflict count last, so most rejected candidates never pay for it. Returns the cost or null. */
function costIfNoWorse(id: string, c: Point[], base: ReturnType<typeof routeCost>, routes: Routes, nodes: IRNode[]) {
  const hits = nodeHits(c, nodes); if (hits > base.hits) return null;
  const hug = hugTotal(c, nodes); if (hug > base.hug) return null;
  const conf = conflicts(id, c, routes); if (conf > base.conf) return null;
  return { hits, conf, hug };
}

/** Drop duplicate and collinear same-direction points. */
function dropCollinear(pts: Point[]): Point[] {
  const out: Point[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    if (Math.abs(a.x - b.x) < TOL && Math.abs(a.y - b.y) < TOL) continue;
    const h = isH(a, b) && isH(b, c) && (b.x - a.x) * (c.x - b.x) > 0;
    const v = isV(a, b) && isV(b, c) && (b.y - a.y) * (c.y - b.y) > 0;
    if (h || v) continue;
    out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Shortest segment a Z-jog removal may leave next to a port (px). */
const MIN_STUB = 8;
/** Longest Z-jog (px) simplifyRoutes will straighten. */
const MAX_JOG = 2 * DS.portStub;

/** Candidate rewrites of the first removable Z-jog: points p0 p1 p2 p3 with p0p1
 *  and p2p3 parallel and p1p2 the jog. Either p0 slides onto p3's line or p3 onto
 *  p0's; the end segments (ports) never move. */
function zJogCandidates(pts: Point[]): Point[][] {
  const out: Point[][] = [];
  for (let i = 0; i + 3 < pts.length; i++) {
    const [p0, p1, p2, p3] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const hz = isH(p0, p1) && isV(p1, p2) && isH(p2, p3);
    const vz = isV(p0, p1) && isH(p1, p2) && isV(p2, p3);
    if (!hz && !vz) continue;
    // A long jog is a deliberate detour (round a group, a node): only small ones go.
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) > MAX_JOG) continue;
    // A: p0 (interior) moves onto p3's line; B: p3 (interior) moves onto p0's line.
    if (i >= 1) {
      const pp = pts[i - 1];
      const np0 = hz ? { x: p0.x, y: p2.y } : { x: p2.x, y: p0.y };
      const len = hz ? Math.abs(np0.y - pp.y) : Math.abs(np0.x - pp.x);
      const same = hz ? (np0.y - pp.y) * (p0.y - pp.y) > 0 : (np0.x - pp.x) * (p0.x - pp.x) > 0;
      if (same && len >= MIN_STUB) out.push([...pts.slice(0, i), np0, ...pts.slice(i + 3)]);
    }
    if (i + 4 < pts.length) {
      const nn = pts[i + 4];
      const np3 = hz ? { x: p3.x, y: p0.y } : { x: p0.x, y: p3.y };
      const len = hz ? Math.abs(np3.y - nn.y) : Math.abs(np3.x - nn.x);
      const same = hz ? (np3.y - nn.y) * (p3.y - nn.y) > 0 : (np3.x - nn.x) * (p3.x - nn.x) > 0;
      if (same && len >= MIN_STUB) out.push([...pts.slice(0, i + 1), np3, ...pts.slice(i + 4)]);
    }
  }
  return out;
}

/** Remove redundant bends: collinear points, and Z-jogs whose removal adds no
 *  node hit, crossing, overlap or border hug. Never touches a port. */
export function simplifyRoutes(routes: Routes, nodes: IRNode[] = []): Routes {
  const out: Routes = new Map(routes);
  for (const id of [...routes.keys()].sort()) {
    let cur = dropCollinear(out.get(id)!);
    for (let pass = 0; pass < 8 && routes.size <= CLEANUP_MAX_ROUTES; pass++) {
      const cands = zJogCandidates(cur);
      if (!cands.length) break;
      const base = routeCost(id, cur, out, nodes);
      let best: Point[] | null = null;
      for (const cand of cands) {
        const c = dropCollinear(cand);
        if (c.length >= cur.length || !costIfNoWorse(id, c, base, out, nodes)) continue;
        if (!best || c.length < best.length) best = c;
      }
      if (!best) break;
      cur = best;
    }
    out.set(id, cur);
  }
  return out;
}

/** Simple L / Z reroutes between a route's own two ports, first leg and last leg
 *  keeping their orientation and direction. */
function simplerCandidates(pts: Point[]): Point[][] {
  const p0 = pts[0], p1 = pts[1], pn = pts[pts.length - 1], pm = pts[pts.length - 2];
  const v0 = isV(p0, p1), vn = isV(pm, pn);
  if (!v0 && !isH(p0, p1)) return [];
  if (!vn && !isH(pm, pn)) return [];
  const out: Point[][] = [];
  if (v0 !== vn) out.push(v0 ? [p0, { x: p0.x, y: pn.y }, pn] : [p0, { x: pn.x, y: p0.y }, pn]);
  else {
    const coords = new Set<number>([v0 ? (p0.y + pn.y) / 2 : (p0.x + pn.x) / 2]);
    for (const q of pts.slice(1, -1)) coords.add(v0 ? q.y : q.x);
    for (const m of [...coords].sort((a, b) => a - b)) {
      out.push(v0 ? [p0, { x: p0.x, y: m }, { x: pn.x, y: m }, pn] : [p0, { x: m, y: p0.y }, { x: m, y: pn.y }, pn]);
    }
  }
  const firstDir = v0 ? Math.sign(p1.y - p0.y) : Math.sign(p1.x - p0.x);
  const lastDir = vn ? Math.sign(pn.y - pm.y) : Math.sign(pn.x - pm.x);
  return dropCollinearAll(out).filter((c) => {
    if (c.length < 2 || segLen(c[0], c[1]) < MIN_STUB || segLen(c[c.length - 2], c[c.length - 1]) < MIN_STUB) return false;
    const f = v0 ? Math.sign(c[1].y - c[0].y) : Math.sign(c[1].x - c[0].x);
    const a = c[c.length - 2], b = c[c.length - 1];
    const l = vn ? Math.sign(b.y - a.y) : Math.sign(b.x - a.x);
    return f === firstDir && l === lastDir && c.length >= 2;
  });
}
const segLen = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const dropCollinearAll = (cs: Point[][]) => cs.map(dropCollinear);

/** A route with more than `maxBends` bends is retried as the simplest L or Z
 *  between its ports, when that adds no node hit, crossing, overlap or hug. */
export function capBends(routes: Routes, nodes: IRNode[] = [], maxBends: number = DS.maxBendsPerEdge): Routes {
  const out: Routes = new Map(routes);
  if (routes.size > CLEANUP_MAX_ROUTES) return out;
  for (const id of [...routes.keys()].sort()) {
    const cur = out.get(id)!;
    if (cur.length - 2 <= maxBends) continue;
    const base = routeCost(id, cur, out, nodes);
    let best: Point[] | null = null, bestKey: number[] = [];
    for (const c of simplerCandidates(cur)) {
      if (c.length >= cur.length) continue;
      const k = costIfNoWorse(id, c, base, out, nodes);
      if (!k) continue;
      const key = [c.length, k.hits + k.conf, c.reduce((t, p, i) => (i ? t + Math.abs(p.x - c[i - 1].x) + Math.abs(p.y - c[i - 1].y) : 0), 0)];
      if (!best || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) { best = c; bestKey = key; }
    }
    if (best) out.set(id, best);
  }
  return out;
}

/** Nudge, then jumps — the single entry point the engine and the metrics
 *  harness share. `jumps` is empty when `jumpsEnabled` is false (sketch edges). */
export function postRoute(ir: Pick<DiagramIR, 'nodes'>, routes: Routes, jumpsEnabled = true, titleBands: Rect[] = []): PostRouted {
  let key = jumpsEnabled ? 'J' : 'j';
  for (const n of ir.nodes) key += `${n.id},${n.shape},${n.position?.x},${n.position?.y},${n.size?.width},${n.size?.height};`;
  key += '|';
  for (const b of titleBands) key += `${b.x},${b.y},${b.width},${b.height};`;
  key += '|';
  for (const [id, pts] of routes) { key += id; for (const p of pts) key += `,${p.x},${p.y}`; key += ';'; }
  const hit = postRouteCache.get(key);
  if (hit) return clonePost(hit);
  const res = postRouteUncached(ir, routes, jumpsEnabled, titleBands);
  postRouteCache.set(key, res);
  if (postRouteCache.size > 6) postRouteCache.delete(postRouteCache.keys().next().value as string);
  return clonePost(res);
}
const clonePost = (r: PostRouted): PostRouted => ({
  routes: new Map([...r.routes].map(([id, pts]) => [id, pts.map((p) => ({ ...p }))])),
  jumps: new Map([...r.jumps].map(([id, h]) => [id, h.map((x) => ({ ...x }))])),
});
const postRouteCache = new Map<string, PostRouted>();
function postRouteUncached(ir: Pick<DiagramIR, 'nodes'>, routes: Routes, jumpsEnabled: boolean, titleBands: Rect[]): PostRouted {
  const nudged = capBends(simplifyRoutes(
    avoidBands(unhugRoutes(nudgeRoutes(simplifyRoutes(fanPorts(snapApexes(routes, ir.nodes), ir.nodes), ir.nodes), ir.nodes), ir.nodes), titleBands, ir.nodes),
    ir.nodes), ir.nodes);
  return { routes: nudged, jumps: jumpsEnabled ? findJumps(nudged) : new Map() };
}

/** Circuit variant: nudge only (net-aware, pins fixed) plus hops that skip
 *  segments ending at a junction. `nets` maps edge id to net key. */
export function postRouteCircuit(ir: Pick<DiagramIR, 'nodes'>, routes: Routes, nets: Map<string, string>, jumpsEnabled = true): PostRouted {
  const nudged = nudgeRoutes(routes, ir.nodes, nets);
  if (!jumpsEnabled) return { routes: nudged, jumps: new Map() };
  const jumps = findJumps(nudged, nets);
  return { routes: nudged, jumps };
}

// ── Path geometry ───────────────────────────────────────────────────────────

const f = (n: number) => Math.round(n * 100) / 100;

/** SVG path data for a polyline with rounded bends (quadratic corner of radius
 *  `r`, clamped to half the shorter adjacent segment) and optional hops over
 *  crossings on horizontal segments. `dx`/`dy` is the canvas padding. */
export function edgePathD(pts: Point[], dx = 0, dy = 0, hops: Hop[] = [], r: number = DS.bendRadius): string {
  if (pts.length < 2) return '';
  const P = (p: Point) => `${f(p.x + dx)},${f(p.y + dy)}`;
  const len = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  let d = `M${P(pts[0])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = len(a, b);
    const ux = L ? (b.x - a.x) / L : 0, uy = L ? (b.y - a.y) / L : 0;
    const rout = i < pts.length - 2 ? Math.min(r, L / 2, len(b, pts[i + 2]) / 2) : 0;
    const end = { x: b.x - ux * rout, y: b.y - uy * rout };
    // Hops on this segment, in travel order.
    const dir = Math.sign(b.x - a.x);
    const here = hops.filter((h) => h.seg === i && !h.vert && isH(a, b)).sort((p, q) => (p.at - q.at) * dir);
    for (const h of here) {
      d += `L${f(h.at - HOP_RADIUS * dir + dx)},${f(a.y + dy)}A${HOP_RADIUS},${HOP_RADIUS} 0 0 ${dir > 0 ? 1 : 0} ${f(h.at + HOP_RADIUS * dir + dx)},${f(a.y + dy)}`;
    }
    // Vertical hops bulge to the right (+x), whichever way the line travels.
    const vdir = Math.sign(b.y - a.y);
    const vhere = hops.filter((h) => h.seg === i && h.vert && isV(a, b)).sort((p, q) => (p.at - q.at) * vdir);
    for (const h of vhere) {
      d += `L${f(a.x + dx)},${f(h.at - HOP_RADIUS * vdir + dy)}A${HOP_RADIUS},${HOP_RADIUS} 0 0 ${vdir > 0 ? 1 : 0} ${f(a.x + dx)},${f(h.at + HOP_RADIUS * vdir + dy)}`;
    }
    d += `L${P(end)}`;
    if (rout > 0) {
      const n = pts[i + 2];
      const L2 = len(b, n);
      const nx = (n.x - b.x) / L2, ny = (n.y - b.y) / L2;
      d += `Q${P(b)} ${P({ x: b.x + nx * rout, y: b.y + ny * rout })}`;
    }
  }
  return d;
}

// ── Arrowheads ──────────────────────────────────────────────────────────────

/** The one arrowhead drawing every edge grammar shares (engine edges, and via
 *  the same call sequence messages / Gantt dependencies): `flow` and
 *  `dependency` are a filled triangle of `DS.arrowScale` × stroke width;
 *  `generalization` hollow triangle (1.4×), `association` open V,
 *  `aggregation` / `composition` diamond. `pad` is the canvas padding. */
export function arrowheadSvg(kind: string, prev: Point, last: Point, pad: number, stroke: string, sw: number = DS.stroke.edge): string {
  const dx = last.x - prev.x, dy = last.y - prev.y, len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0 || kind === 'none') return '';
  const nx = dx / len, ny = dy / len;
  const ax = last.x + pad, ay = last.y + pad;
  const asz = DS.arrowScale * sw * (kind === 'generalization' ? 1.4 : 1);
  const hw = asz * 0.5;
  const p1x = ax - asz * nx - hw * ny, p1y = ay - asz * ny + hw * nx;
  const p2x = ax - asz * nx + hw * ny, p2y = ay - asz * ny - hw * nx;
  switch (kind) {
    case 'generalization':
      return `    <polygon points="${p1x},${p1y} ${p2x},${p2y} ${ax},${ay}" fill="${DS.neutral.surface}" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>\n`;
    case 'association':
      return `    <polyline points="${p1x},${p1y} ${ax},${ay} ${p2x},${p2y}" fill="none" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>\n`;
    case 'aggregation':
    case 'composition': {
      const midx = ax - asz * nx, midy = ay - asz * ny;
      const fill = kind === 'composition' ? stroke : DS.neutral.surface;
      return `    <polygon points="${ax},${ay} ${p1x},${p1y} ${midx},${midy} ${p2x},${p2y}" fill="${fill}" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>\n`;
    }
    case 'dependency':
    case 'flow':
    default:
      return `    <polygon points="${p1x},${p1y} ${p2x},${p2y} ${ax},${ay}" fill="${stroke}" stroke="${stroke}" stroke-width="${DS.stroke.hairline}"/>\n`;
  }
}

// ── Group title bands ───────────────────────────────────────────────────────

/** The chip behind a group's title (layout coordinates, no canvas padding), as
 *  engine.ts draws it above the edges. Title text starts 10px in, baseline at
 *  fontSize + 4; `fontSize` defaults to the group style's 14. */
export function groupTitleBand(g: Pick<IRGroup, 'label' | 'position' | 'style'>): Rect | undefined {
  if (!g.label) return undefined;
  const fs = (g.style?.fontSize as number) || 14;
  const lines = g.label.replace(/\\n/g, '\n').split('\n');
  const tw = Math.max(...lines.map((l) => textWidth(l, fs))) * 1.12;
  return { x: g.position.x + 10 - DS.chip.padX, y: g.position.y + 3, width: tw + 2 * DS.chip.padX, height: fs * 1.2 * lines.length + 2 * DS.chip.padY };
}

/** Title bands of every labelled group — the `titleBands` argument of postRoute. */
export function groupTitleBands(groups: ReadonlyArray<Pick<IRGroup, 'label' | 'position' | 'style'>> = []): Rect[] {
  return groups.map(groupTitleBand).filter((r): r is Rect => !!r);
}
