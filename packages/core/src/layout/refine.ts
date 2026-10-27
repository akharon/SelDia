// Layout-variant scoring and the post-layout neighbour-swap pass used by the
// `auto` engine. Everything here is deterministic.

import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { Point } from '../types/common.js';
import { layoutScore, routedPaths } from './metrics.js';

/** Layer index of each node: centres along the layer axis, clustered. */
export function layerIndex(nodes: IRNode[], vertical: boolean): Map<string, number> {
  const c = (n: IRNode) => (vertical ? n.position.y + n.size.height / 2 : n.position.x + n.size.width / 2);
  const sorted = [...nodes].sort((a, b) => c(a) - c(b) || (a.id < b.id ? -1 : 1));
  const out = new Map<string, number>();
  let layer = -1, first = -Infinity;
  for (const n of sorted) {
    if (c(n) - first > 40) { layer++; first = c(n); }
    out.set(n.id, layer);
  }
  return out;
}

/** Sum over edges of the layers they skip beyond the adjacent one. */
export function rankSkipPenalty(ir: Pick<DiagramIR, 'nodes' | 'edges'>, vertical: boolean): number {
  const layers = layerIndex(ir.nodes, vertical);
  let p = 0;
  for (const e of ir.edges ?? []) {
    const a = layers.get(e.sourceId), b = layers.get(e.targetId);
    if (a !== undefined && b !== undefined) p += Math.max(0, Math.abs(a - b) - 1);
  }
  return p;
}

/** Total length of the routed (drawn) edge paths. */
export function routedLength(ir: DiagramIR): number {
  let len = 0;
  for (const w of routedPaths(ir).values()) for (let i = 1; i < w.length; i++) len += Math.abs(w[i].x - w[i - 1].x) + Math.abs(w[i].y - w[i - 1].y);
  return len;
}

/** Lexicographic score, lower is better: gated defects (incl. over-cap bends), crossings * DS.crossingBendWeight + bends,
 *  rank-skip penalty, routed length. */
export function fullScore(ir: DiagramIR, vertical: boolean): number[] {
  return [...layoutScore(ir), rankSkipPenalty(ir, vertical), Math.round(routedLength(ir))];
}

export function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

interface Laid { nodes: IRNode[]; edges: IREdge[] }

/** Swap two nodes of one layer in place of each other (the pair keeps its overall
 *  span); edges touching them are reset to centre-to-centre hints. */
function applySwap(nodes: IRNode[], edges: IREdge[], aId: string, bId: string, vertical: boolean): Laid {
  const A = nodes.find((n) => n.id === aId)!, B = nodes.find((n) => n.id === bId)!;
  const cross = (n: IRNode) => (vertical ? n.position.x : n.position.y);
  const size = (n: IRNode) => (vertical ? n.size.width : n.size.height);
  const [L, R] = cross(A) <= cross(B) ? [A, B] : [B, A];
  const gap = cross(R) - (cross(L) + size(L));
  const place = new Map([[R.id, cross(L)], [L.id, cross(L) + size(R) + gap]]);
  const nn = nodes.map((n) => {
    const v = place.get(n.id);
    return v === undefined ? n : { ...n, position: vertical ? { x: v, y: n.position.y } : { x: n.position.x, y: v } };
  });
  const byId = new Map(nn.map((n) => [n.id, n]));
  const centre = (n: IRNode): Point => ({ x: n.position.x + n.size.width / 2, y: n.position.y + n.size.height / 2 });
  const ne = edges.map((e) => {
    if (![e.sourceId, e.targetId].some((id) => id === aId || id === bId)) return e;
    const s = byId.get(e.sourceId), t = byId.get(e.targetId);
    return s && t ? { ...e, layoutRouted: false, waypoints: [centre(s), centre(t)] } : e;
  });
  return { nodes: nn, edges: ne };
}

/** Deterministic neighbour-swap pass. A move is one swap of two adjacent nodes of
 *  a layer, or (when no single swap helps) a pair of swaps; it is kept only when
 *  it adds no gated defect and strictly lowers crossings, or keeps them and
 *  strictly lowers bends. At most `maxTries` candidates are evaluated. */
export function swapNeighbours<T extends Laid>(ir: DiagramIR, res: T, vertical: boolean, maxTries = 60): T {
  let cur: Laid = { nodes: res.nodes, edges: res.edges };
  const measure = (l: Laid) => layoutScore({ ...ir, nodes: l.nodes, edges: l.edges, groups: [] });
  let score = measure(cur);
  let tries = 0;
  const better = (sc: number[]) => sc[0] <= score[0] && sc[1] < score[1];
  const candidates = (l: Laid): Array<[string, string]> => {
    const layers = layerIndex(l.nodes, vertical);
    const byLayer = new Map<number, IRNode[]>();
    for (const n of l.nodes) (byLayer.get(layers.get(n.id)!) ?? byLayer.set(layers.get(n.id)!, []).get(layers.get(n.id)!)!).push(n);
    const out: Array<[string, string]> = [];
    for (const k of [...byLayer.keys()].sort((a, b) => a - b)) {
      const row = byLayer.get(k)!.sort((a, b) => (vertical ? a.position.x - b.position.x : a.position.y - b.position.y) || (a.id < b.id ? -1 : 1));
      for (let i = 0; i + 1 < row.length; i++) out.push([row[i].id, row[i + 1].id]);
    }
    return out;
  };
  for (let round = 0; round < 3 && tries < maxTries; round++) {
    let moved = false;
    const singles: Array<{ pair: [string, string]; sc: number[] }> = [];
    for (const [a, b] of candidates(cur)) {
      if (tries++ >= maxTries) break;
      const next = applySwap(cur.nodes, cur.edges, a, b, vertical);
      const sc = measure(next);
      if (better(sc)) { cur = next; score = sc; moved = true; }
      else singles.push({ pair: [a, b], sc });
    }
    if (!moved) {
      // Two swaps at once: the first may only pay off together with the second.
      singles.sort((x, y) => x.sc[0] - y.sc[0] || x.sc[1] - y.sc[1]);
      const top = singles.slice(0, 10);
      outer: for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
        const [a, b] = top[i].pair, [c, d] = top[j].pair;
        if (new Set([a, b, c, d]).size < 4) continue;
        if (tries++ >= maxTries) break outer;
        const first = applySwap(cur.nodes, cur.edges, a, b, vertical);
        const next = applySwap(first.nodes, first.edges, c, d, vertical);
        const sc = measure(next);
        if (better(sc)) { cur = next; score = sc; moved = true; break outer; }
      }
    }
    if (!moved) break;
  }
  if (cur.nodes === res.nodes) return res;
  return { ...res, nodes: cur.nodes, edges: cur.edges };
}

// ---------------------------------------------------------------------------
// Median / barycenter crossing sweep
// ---------------------------------------------------------------------------

type Seg = [number, number, number, number];

function segCross(a: Seg, b: Seg): boolean {
  const d = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d1 = d(a[0], a[1], a[2], a[3], b[0], b[1]), d2 = d(a[0], a[1], a[2], a[3], b[2], b[3]);
  const d3 = d(b[0], b[1], b[2], b[3], a[0], a[1]), d4 = d(b[0], b[1], b[2], b[3], a[2], a[3]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Reassign nodes of each rank to that rank's original slots: the rank keeps its
 *  start coordinate and its sequence of gaps, so overall spacing is unchanged. */
function placeOrder(nodes: IRNode[], ranks: string[][], slots: Array<{ start: number; gaps: number[] }>, vertical: boolean): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const size = (n: IRNode) => (vertical ? n.size.width : n.size.height);
  const out = new Map<string, number>();
  ranks.forEach((row, k) => {
    let at = slots[k].start;
    row.forEach((id, i) => { out.set(id, at); at += size(byId.get(id)!) + (slots[k].gaps[i] ?? 0); });
  });
  return out;
}

/** Deterministic median/barycenter sweeps. Candidate orders are ranked by a
 *  straight-segment crossing proxy; the best few are routed and measured for
 *  real, and one replaces the layout only when the full score strictly improves.
 *  Rank slot coordinates are kept, so spacing does not change. Layouts with
 *  groups are left alone (a group's members must stay together). */
export function sweepOrder<T extends Laid>(ir: DiagramIR, res: T, vertical: boolean, sweeps = 4, evalMax = 3): T {
  if (ir.groups?.length || res.nodes.length < 3) return res;
  const layers = layerIndex(res.nodes, vertical);
  const nRanks = Math.max(...layers.values()) + 1;
  const cross = (n: IRNode) => (vertical ? n.position.x : n.position.y);
  const csize = (n: IRNode) => (vertical ? n.size.width : n.size.height);
  const byId = new Map(res.nodes.map((n) => [n.id, n]));
  const ranks: string[][] = Array.from({ length: nRanks }, () => []);
  for (const n of res.nodes) ranks[layers.get(n.id)!].push(n.id);
  const slots = ranks.map((row) => {
    row.sort((a, b) => cross(byId.get(a)!) - cross(byId.get(b)!) || (a < b ? -1 : 1));
    const gaps = row.map((id, i) => i + 1 < row.length ? cross(byId.get(row[i + 1])!) - (cross(byId.get(id)!) + csize(byId.get(id)!)) : 0);
    return { start: cross(byId.get(row[0])!), gaps };
  });
  const edges = (res.edges ?? []).filter((e) => e.sourceId !== e.targetId && layers.has(e.sourceId) && layers.has(e.targetId) && layers.get(e.sourceId) !== layers.get(e.targetId));
  if (edges.length < 2) return res;
  const nbrs = new Map<string, string[]>();
  for (const e of edges) {
    (nbrs.get(e.sourceId) ?? nbrs.set(e.sourceId, []).get(e.sourceId)!).push(e.targetId);
    (nbrs.get(e.targetId) ?? nbrs.set(e.targetId, []).get(e.targetId)!).push(e.sourceId);
  }
  const centres = (order: string[][]) => {
    const pos = placeOrder(res.nodes, order, slots, vertical);
    const c = new Map<string, number>();
    for (const [id, p] of pos) c.set(id, p + csize(byId.get(id)!) / 2);
    return c;
  };
  const proxy = (order: string[][]) => {
    const c = centres(order);
    const lay = (id: string) => (layers.get(id)! * 1000);
    const segs: Array<{ s: Seg; a: string; b: string }> = edges.map((e) => ({ s: [c.get(e.sourceId)!, lay(e.sourceId), c.get(e.targetId)!, lay(e.targetId)], a: e.sourceId, b: e.targetId }));
    let x = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i], q = segs[j];
      if (p.a === q.a || p.a === q.b || p.b === q.a || p.b === q.b) continue;
      if (segCross(p.s, q.s)) x++;
    }
    return x;
  };
  const key = (o: string[][]) => o.map((r) => r.join(',')).join('|');
  const start = ranks.map((r) => [...r]);
  const seen = new Map<string, { order: string[][]; px: number }>();
  seen.set(key(start), { order: start, px: proxy(start) });
  const startPx = seen.get(key(start))!.px;
  if (startPx === 0) return res;
  for (const useMedian of [false, true]) {
    let order = start.map((r) => [...r]);
    for (let it = 0; it < sweeps; it++) {
      const down = it % 2 === 0;
      const ids = down ? [...order.keys()] : [...order.keys()].reverse();
      for (const k of ids) {
        const c = centres(order);
        const cur = new Map(order[k].map((id, i) => [id, i]));
        const val = new Map<string, number>();
        for (const id of order[k]) {
          const ns = (nbrs.get(id) ?? []).filter((m) => (down ? layers.get(m)! < k : layers.get(m)! > k)).map((m) => c.get(m)!).sort((a, b) => a - b);
          if (!ns.length) { val.set(id, c.get(id)!); continue; }
          val.set(id, useMedian ? (ns.length % 2 ? ns[(ns.length - 1) / 2] : (ns[ns.length / 2 - 1] + ns[ns.length / 2]) / 2) : ns.reduce((s, v) => s + v, 0) / ns.length);
        }
        order[k] = [...order[k]].sort((a, b) => val.get(a)! - val.get(b)! || cur.get(a)! - cur.get(b)! );
      }
      const kk = key(order);
      if (!seen.has(kk)) seen.set(kk, { order: order.map((r) => [...r]), px: proxy(order) });
    }
  }
  const cands = [...seen.values()].filter((v) => v.px < startPx).sort((a, b) => a.px - b.px).slice(0, evalMax);
  if (!cands.length) return res;
  const build = (order: string[][]): Laid => {
    const pos = placeOrder(res.nodes, order, slots, vertical);
    const nodes = res.nodes.map((n) => {
      const v = pos.get(n.id);
      return v === undefined || v === cross(n) ? n : { ...n, position: vertical ? { x: v, y: n.position.y } : { x: n.position.x, y: v } };
    });
    const moved = new Set(nodes.filter((n, i) => n !== res.nodes[i]).map((n) => n.id));
    const nb = new Map(nodes.map((n) => [n.id, n]));
    const centre = (n: IRNode): Point => ({ x: n.position.x + n.size.width / 2, y: n.position.y + n.size.height / 2 });
    const ne = (res.edges ?? []).map((e) => {
      if (!moved.has(e.sourceId) && !moved.has(e.targetId)) return e;
      const s = nb.get(e.sourceId), t = nb.get(e.targetId);
      return s && t ? { ...e, layoutRouted: false, waypoints: [centre(s), centre(t)] } : e;
    });
    return { nodes, edges: ne };
  };
  const full = (l: Laid) => fullScore({ ...ir, nodes: l.nodes, edges: l.edges, groups: [] }, vertical);
  let best: Laid = { nodes: res.nodes, edges: res.edges };
  let bestSc = full(best);
  for (const c of cands) {
    const l = build(c.order);
    const sc = full(l);
    if (sc[0] <= bestSc[0] && lexLess(sc, bestSc)) { best = l; bestSc = sc; }
  }
  if (best.nodes === res.nodes) return res;
  return { ...res, nodes: best.nodes, edges: best.edges };
}
