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

/** Lexicographic score, lower is better: gated defects, crossings, bends,
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
  const better = (sc: number[]) => sc[0] <= score[0] && (sc[1] < score[1] || (sc[1] === score[1] && sc[2] < score[2]));
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
      singles.sort((x, y) => x.sc[0] - y.sc[0] || x.sc[1] - y.sc[1] || x.sc[2] - y.sc[2]);
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
