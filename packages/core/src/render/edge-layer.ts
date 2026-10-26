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

interface Run { id: string; seg: number; coord: number; lo: number; hi: number; }

function collectRuns(routes: Routes, horizontal: boolean): Run[] {
  const runs: Run[] = [];
  for (const [id, pts] of routes) {
    // Segments touching a port stay put: moving them would detach the edge.
    for (let i = 1; i < pts.length - 2; i++) {
      const a = pts[i], b = pts[i + 1];
      if (horizontal ? !isH(a, b) : !isV(a, b)) continue;
      runs.push(horizontal
        ? { id, seg: i, coord: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) }
        : { id, seg: i, coord: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
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
        } else ids.forEach((k, n) => offs.set(k, (n - (ids.length - 1) / 2) * step));
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

// ── Port fanning ────────────────────────────────────────────────────────────

type Side = 'T' | 'B' | 'L' | 'R';
interface End { id: string; end: 0 | 1; node: IRNode; side: Side; key: number; key2: number; }

/** Spread route ends that share one side of a box-shaped node: k ends sit at
 *  (i+1)/(k+1) of the side, ordered by the coordinate they approach from, so
 *  the parallel runs into the node never overlap and no new crossing appears.
 *  The last orthogonal segment is re-bent: its neighbour bend moves with the
 *  end. A route whose change would fold it or cut into a node keeps its old
 *  end. Ends alone on a side stay where they are. */
export function fanPorts(routes: Routes, nodes: IRNode[]): Routes {
  const boxes = nodes.filter(nodeShapeIsBox);
  if (!boxes.length) return routes;
  const ends: End[] = [];
  for (const [id, pts] of routes) {
    if (pts.length < 2) continue;
    for (const end of [0, 1] as const) {
      const p = end ? pts[pts.length - 1] : pts[0], q = end ? pts[pts.length - 2] : pts[1];
      const far = end ? (pts[pts.length - 3] ?? pts[0]) : (pts[2] ?? pts[pts.length - 1]);
      let node: IRNode | undefined, side: Side | undefined, key = 0, key2 = 0;
      if (isV(p, q)) {
        node = boxes.find((n) => p.x > n.position.x + 1 && p.x < n.position.x + n.size.width - 1
          && (Math.abs(p.y - n.position.y) < 5 || Math.abs(p.y - (n.position.y + n.size.height)) < 5));
        if (node) { side = Math.abs(p.y - node.position.y) < 5 ? 'T' : 'B'; key = far.x; key2 = (far.x < p.x ? 1 : -1) * Math.abs(p.y - q.y); }
      } else if (isH(p, q)) {
        node = boxes.find((n) => p.y > n.position.y + 1 && p.y < n.position.y + n.size.height - 1
          && (Math.abs(p.x - n.position.x) < 5 || Math.abs(p.x - (n.position.x + n.size.width)) < 5));
        if (node) { side = Math.abs(p.x - node.position.x) < 5 ? 'L' : 'R'; key = far.y; key2 = (far.y < p.y ? 1 : -1) * Math.abs(p.x - q.x); }
      }
      if (node && side) ends.push({ id, end, node, side, key, key2 });
    }
  }
  const groups = new Map<string, End[]>();
  for (const e of ends) (groups.get(`${e.node.id}:${e.side}`) ?? groups.set(`${e.node.id}:${e.side}`, []).get(`${e.node.id}:${e.side}`)!).push(e);

  const next = new Map<string, Point[]>();
  const get = (id: string) => next.get(id) ?? routes.get(id)!.map((p) => ({ ...p }));
  for (const list of [...groups.values()].sort((a, b) => (a[0].node.id + a[0].side < b[0].node.id + b[0].side ? -1 : 1))) {
    if (list.length < 2) continue;
    list.sort((a, b) => (Math.abs(a.key - b.key) < 1 ? 0 : a.key - b.key) || a.key2 - b.key2 || (a.id < b.id ? -1 : a.id > b.id ? 1 : a.end - b.end));
    const n = list[0].node, side = list[0].side, k = list.length;
    list.forEach((e, i) => {
      const t = (i + 1) / (k + 1);
      const pts = get(e.id);
      const last = e.end ? pts.length - 1 : 0, adj = e.end ? pts.length - 2 : 1;
      if (side === 'T' || side === 'B') {
        const x = n.position.x + t * n.size.width;
        pts[last].x = x; pts[adj].x = x;
      } else {
        const y = n.position.y + t * n.size.height;
        pts[last].y = y; pts[adj].y = y;
      }
      next.set(e.id, pts);
    });
  }
  const out: Routes = new Map();
  for (const [id, pts] of routes) {
    let q = next.get(id);
    if (!q) { out.set(id, pts); continue; }
    // A straight two-point route whose ends no longer line up becomes a Z.
    if (q.length === 2 && (isV(pts[0], pts[1]) ? Math.abs(q[0].x - q[1].x) >= TOL : Math.abs(q[0].y - q[1].y) >= TOL)) {
      const vert = isV(pts[0], pts[1]);
      const m = vert ? (q[0].y + q[1].y) / 2 : (q[0].x + q[1].x) / 2;
      q = vert ? [q[0], { x: q[0].x, y: m }, { x: q[1].x, y: m }, q[1]] : [q[0], { x: m, y: q[0].y }, { x: m, y: q[1].y }, q[1]];
    }
    // Only the end segments move, so only they may differ from the original.
    const ok = q.length === pts.length ? sameDirections(pts, q) : true;
    out.set(id, ok && nodeHits(q, nodes) <= nodeHits(pts, nodes) ? q : pts);
  }
  return out;
}

/** Nudge, then jumps — the single entry point the engine and the metrics
 *  harness share. `jumps` is empty when `jumpsEnabled` is false (sketch edges). */
export function postRoute(ir: Pick<DiagramIR, 'nodes'>, routes: Routes, jumpsEnabled = true, titleBands: Rect[] = []): PostRouted {
  const nudged = avoidBands(nudgeRoutes(fanPorts(snapApexes(routes, ir.nodes), ir.nodes), ir.nodes), titleBands, ir.nodes);
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
