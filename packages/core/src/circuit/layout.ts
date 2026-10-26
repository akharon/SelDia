// =============================================================================
// SelDiA — Circuit schematic layout (ELK layered, fixed ports)
// =============================================================================
// Every part is an ELK node with one port per pin, pinned at the oriented
// symbol's pin position (FIXED_POS), so wires end exactly on the pins. Edges
// come back orthogonally routed (`layoutRouted`) and are drawn untouched.
// Junction nodes (3+ pin nets) are 0x0 and get a dot at their centre.
// =============================================================================

import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { CustomLayoutResult } from '../render/custom-layout.js';
import { layoutSync } from '../layout/elk-sync.js';
import { sectionsToPoints } from '../layout/engines.js';
import type { PartLayout } from './model.js';
import type { Point } from '../types/common.js';

const SIDE: Record<string, string> = { N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST' };

export const SCHEMATIC_ELK_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.spacing.portPort': '10',
  'elk.spacing.nodeNode': '36',
  'elk.layered.spacing.nodeNodeBetweenLayers': '56',
  'elk.layered.spacing.edgeNodeBetweenLayers': '24',
  'elk.spacing.edgeEdge': '14',
  'elk.separateConnectedComponents': 'false',
  'elk.padding': '[top=20,left=20,bottom=20,right=20]',
};


const STUB = 20, DROP = 10;

/** Route and symbol placement for one power pin, relative to the part's box origin. */
function powerPlacement(pp: { x: number; y: number; side: string }, ground: boolean, sp: { x: number; y: number }): { route: Point[]; symPos: Point } {
  const a = { x: pp.x, y: pp.y };
  const dx = pp.side === 'E' ? 1 : pp.side === 'W' ? -1 : 0;
  const dy = pp.side === 'S' ? 1 : pp.side === 'N' ? -1 : 0;
  let route: Point[];
  let tip: Point;
  if (dx !== 0) {
    const sx = a.x + dx * STUB;
    tip = { x: sx, y: ground ? a.y + DROP : a.y - DROP };
    route = [a, { x: sx, y: a.y }, tip];
  } else if ((dy > 0) === ground) {
    tip = { x: a.x, y: a.y + dy * STUB };
    route = [a, tip];
  } else {
    const sy = a.y + dy * (ground ? DROP : 2 * DROP), sx = a.x + STUB;
    tip = { x: sx, y: ground ? sy + 2 * DROP : sy + 6 };   // rail: bar stays just below the body, clear of it
    route = [a, { x: a.x, y: sy }, { x: sx, y: sy }, tip];
  }
  return { route, symPos: { x: tip.x - sp.x, y: tip.y - sp.y } };
}

export function layoutCircuit(ir: DiagramIR): CustomLayoutResult {
  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  const isPower = (n: IRNode) => (n.data as any)?.role === 'power';
  const powerIds = new Set(ir.nodes.filter(isPower).map((n) => n.id));
  const portId = (nodeId: string, pin: string | undefined) => `${nodeId}::${pin}`;

  // Room for power symbols: each part's ELK box grows to hold its stubs and
  // symbols, so neighbours are laid out around them rather than over them.
  const margin = new Map<string, { l: number; t: number }>();
  const powerOf = new Map<string, Array<{ pin: string; ground: boolean; sym: IRNode }>>();
  for (const e of ir.edges) {
    const pwId = powerIds.has(e.sourceId) ? e.sourceId : powerIds.has(e.targetId) ? e.targetId : undefined;
    if (!pwId) continue;
    const partId = pwId === e.sourceId ? e.targetId : e.sourceId;
    const pin = pwId === e.sourceId ? (e.data as any).tgtPin : (e.data as any).srcPin;
    const sym = byId.get(pwId)!;
    (powerOf.get(partId) ?? powerOf.set(partId, []).get(partId)!).push({ pin, ground: (sym.data as any).kind === 'GND', sym });
  }
  for (const n of ir.nodes) {
    const items = powerOf.get(n.id); const c: PartLayout | undefined = (n.data as any)?.circuit;
    if (!items || !c) continue;
    let minX = 0, minY = 0, maxX = n.size.width, maxY = n.size.height;
    for (const it of items) {
      const pp = c.pins.find((q) => q.name === it.pin); if (!pp) continue;
      const sl = (it.sym.data as any).circuit as PartLayout;
      const { symPos } = powerPlacement(pp, it.ground, sl.pins[0]);
      minX = Math.min(minX, symPos.x - 4); minY = Math.min(minY, symPos.y - 4);
      maxX = Math.max(maxX, symPos.x + sl.symW + 40); maxY = Math.max(maxY, symPos.y + it.sym.size.height + 4);
    }
    margin.set(n.id, { l: -minX, t: -minY });
    (n as any).__ext = { w: maxX - minX, h: maxY - minY };
  }

  const children = ir.nodes.filter((n) => !powerIds.has(n.id)).map((n) => {
    const c: PartLayout | undefined = (n.data as any)?.circuit;
    const m = margin.get(n.id) ?? { l: 0, t: 0 };
    const ext = (n as any).__ext as { w: number; h: number } | undefined;
    const child: any = { id: n.id, width: ext?.w ?? n.size.width, height: ext?.h ?? n.size.height };
    const opts: Record<string, string> = {};
    if (c) {
      opts['elk.portConstraints'] = 'FIXED_POS';
      child.ports = c.pins.map((p) => ({
        id: portId(n.id, p.name), x: p.x + m.l, y: p.y + m.t, width: 0, height: 0,
        layoutOptions: { 'elk.port.side': SIDE[p.side] },
      }));
    }
    // `rank in/out` hints pin a part to the first/last layer.
    const rank = (n.data as any)?.rank;
    if (rank === 'in') opts['elk.layered.layering.layerConstraint'] = 'FIRST';
    else if (rank === 'out') opts['elk.layered.layering.layerConstraint'] = 'LAST';
    if (Object.keys(opts).length) child.layoutOptions = opts;
    return child;
  });

  const portKnown = (nodeId: string, pin?: string) => {
    if (!pin) return false;
    return ((byId.get(nodeId)?.data as any)?.circuit as PartLayout | undefined)?.pins.some((p) => p.name === pin) ?? false;
  };
  // Signal flows W->E (and N->S): a wire leaves an out-side pin (E/S) and
  // enters an in-side pin (W/N). Junctions take their direction from the part
  // they join. Without this, parts that only meet through junctions all land in
  // one layer.
  const sideOf = (nodeId: string, pin?: string): number => {
    const c = (byId.get(nodeId)?.data as any)?.circuit as PartLayout | undefined;
    const p = pin ? c?.pins.find((q) => q.name === pin) : undefined;
    return !p ? 0 : (p.side === 'E' || p.side === 'S') ? 1 : -1;
  };
  const reversed = new Set<string>();
  const elkEdges = ir.edges.filter((e) => !powerIds.has(e.sourceId) && !powerIds.has(e.targetId)).map((e) => {
    const d = (e.data ?? {}) as any;
    const a = sideOf(e.sourceId, d.srcPin), b = sideOf(e.targetId, d.tgtPin);
    const rev = (a === -1 && b !== -1) || (b === 1 && a !== 1);
    if (rev) reversed.add(e.id);
    const s0 = portKnown(e.sourceId, d.srcPin) ? portId(e.sourceId, d.srcPin) : e.sourceId;
    const t0 = portKnown(e.targetId, d.tgtPin) ? portId(e.targetId, d.tgtPin) : e.targetId;
    return { id: e.id, sources: [rev ? t0 : s0], targets: [rev ? s0 : t0] };
  });

  const out = layoutSync({ id: 'root', layoutOptions: SCHEMATIC_ELK_OPTIONS, children, edges: elkEdges });

  const pos = new Map<string, { x: number; y: number }>();
  for (const c of out.children ?? []) pos.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
  const nodes: IRNode[] = ir.nodes.map((n) => {
    const q = pos.get(n.id) ?? { x: 0, y: 0 }, m = margin.get(n.id) ?? { l: 0, t: 0 };
    const { __ext, ...rest } = n as any;
    return { ...rest, position: { x: q.x + m.l, y: q.y + m.t } } as IRNode;
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const edges: IREdge[] = ir.edges.map((e) => {
    const withData = (pts: Point[]) => ({ ...e, waypoints: pts, layoutRouted: true, data: { ...(e.data ?? {}), exactEnds: true } } as IREdge);
    if (powerIds.has(e.sourceId) || powerIds.has(e.targetId)) return withData([]);
    const re = (out.edges ?? []).find((x: any) => x.id === e.id);
    let pts = re ? sectionsToPoints(re.sections ?? []) : [];
    if (reversed.has(e.id)) pts = pts.reverse();
    return withData(pts);
  });

  // Power symbols: one per pin, a 20px stub leaving the pin outward, then a
  // single bend; GND always hangs below the stub end, VCC/VDD always sits above.
  for (const e of edges) {
    const pw = powerIds.has(e.sourceId) ? nodeById.get(e.sourceId)! : powerIds.has(e.targetId) ? nodeById.get(e.targetId)! : undefined;
    if (!pw) continue;
    const partId = pw.id === e.sourceId ? e.targetId : e.sourceId;
    const part = nodeById.get(partId)!;
    const pin = pw.id === e.sourceId ? (e.data as any).tgtPin : (e.data as any).srcPin;
    const pl = (part.data as any).circuit as PartLayout;
    const pp = pl.pins.find((q) => q.name === pin);
    if (!pp) continue;
    const ground = (pw.data as any).kind === 'GND';
    const sl = (pw.data as any).circuit as PartLayout;
    const pl0 = pp;
    const { route: rel, symPos } = powerPlacement(pl0, ground, sl.pins[0]);
    const route = rel.map((q) => ({ x: q.x + part.position.x, y: q.y + part.position.y }));
    pw.position = { x: symPos.x + part.position.x, y: symPos.y + part.position.y };
    e.waypoints = pw.id === e.sourceId ? route.reverse() : route;
  }

  // Junction dots from the routed geometry: a dot belongs where three or more
  // distinct directions leave one point on the same net (a real T or cross),
  // not wherever a 0x0 node happened to land.
  const byNet = new Map<string, IREdge[]>();
  for (const e of edges) {
    const d = e.data as any;
    if (d.role !== 'wire' || powerIds.has(e.sourceId) || powerIds.has(e.targetId)) continue;
    (byNet.get(d.net) ?? byNet.set(d.net, []).get(d.net)!).push(e);
  }
  for (const n of nodes) if ((n.data as any)?.role === 'junction') (n.data as any).dots = [];
  for (const [net, es] of byNet) {
    const jn = nodes.find((n) => (n.data as any)?.role === 'junction' && (n.data as any).net === net);
    if (!jn) continue;
    (jn.data as any).dots = tJunctions(es.map((e) => e.waypoints ?? []));
  }

  const w = (out.width ?? 0) as number, h = (out.height ?? 0) as number;
  let maxX = w, maxY = h;
  for (const n of nodes) { maxX = Math.max(maxX, n.position.x + n.size.width + 20); maxY = Math.max(maxY, n.position.y + n.size.height + 20); }
  return { nodes, edges, bounds: { x: 0, y: 0, width: maxX + 40, height: maxY + 40 } };
}

type Pt = { x: number; y: number };

/** Points where >= 3 distinct axis directions meet across the net's polylines. */
export function tJunctions(polys: Pt[][]): Pt[] {
  const r = (v: number) => Math.round(v * 2) / 2;
  const segs: Array<[Pt, Pt]> = [];
  for (const poly of polys) for (let i = 0; i + 1 < poly.length; i++) {
    const a = { x: r(poly[i].x), y: r(poly[i].y) }, b = { x: r(poly[i + 1].x), y: r(poly[i + 1].y) };
    if (a.x !== b.x || a.y !== b.y) segs.push([a, b]);
  }
  const cand = new Map<string, Pt>();
  for (const [a, b] of segs) { cand.set(`${a.x},${a.y}`, a); cand.set(`${b.x},${b.y}`, b); }
  const dots: Pt[] = [];
  for (const p of cand.values()) {
    const dirs = new Set<string>();
    for (const [a, b] of segs) {
      const horiz = a.y === b.y && a.y === p.y, vert = a.x === b.x && a.x === p.x;
      if (horiz && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)) {
        if (p.x > Math.min(a.x, b.x)) dirs.add('L');
        if (p.x < Math.max(a.x, b.x)) dirs.add('R');
      } else if (vert && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) {
        if (p.y > Math.min(a.y, b.y)) dirs.add('U');
        if (p.y < Math.max(a.y, b.y)) dirs.add('D');
      }
    }
    if (dirs.size >= 3) dots.push(p);
  }
  return dots;
}
