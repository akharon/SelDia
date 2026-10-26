// =============================================================================
// SelDiA — Circuit model (importer-neutral)
// =============================================================================
// SPICE and KiCad netlists both reduce to this: parts with typed pins, and nets
// listing `Ref.pin` members. circuitToIR() turns it into the shared DiagramIR.
// =============================================================================

import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';
import { symbolFor, orient, SYMBOLS, type SymbolDef, type PinSide } from './symbols.js';
import { measureLabel } from '../layout/text-measure.js';

export interface CircuitPart {
  ref: string;
  kind: string;
  pins: string[];
  value: string;
  /** NPN / PNP / NMOS / PMOS ... from a `.model` line, when known. */
  modelType?: string;
}

export type CircuitHint =
  | { op: 'rotate'; ref: string; deg: number }
  | { op: 'flip'; ref: string }
  | { op: 'rank'; where: 'in' | 'out'; refs: string[] };

export interface CircuitModel {
  title?: string;
  parts: CircuitPart[];
  /** net name -> `Ref.pin` members, in order of appearance. */
  nets: Record<string, string[]>;
  /** Ground and supply-rail net names. */
  powerNets: string[];
  hints: CircuitHint[];
  warnings: string[];
}

export const MAX_PARTS = 40;

export function isGroundName(name: string): boolean { return /^(0|gnd|agnd|dgnd|pgnd|gnd\d*)$/i.test(name); }
export function isRailName(name: string): boolean { return /^(vcc|vdd|vss|vee|avcc|avdd|vcc\d*|vdd\d*|[+-]\d+(\.\d+)?v\d*|[+-]?\d+v\d+)$/i.test(name); }
export function isPowerName(name: string): boolean { return isGroundName(name) || isRailName(name); }

/** The size/orientation facts layout and renderer both need for one part. */
export interface PartLayout {
  symbol: string;           // symbol kind, for the renderer
  rot: number;
  flip: boolean;
  /** Where the oriented symbol sits inside the node box. */
  symX: number; symY: number;
  symW: number; symH: number;
  transform: string;
  pins: Array<{ name: string; x: number; y: number; side: PinSide }>;   // node-box coordinates
  labelSide: 'N' | 'S' | 'E';
  labelX: number; labelY: number; anchor: 'start' | 'middle';
  lines: string[];
}

const LABEL_FS = 11;

/** Compute a part's node-box geometry: oriented symbol plus a label zone on
 *  the first side that carries no pins. */
export function partLayout(def: SymbolDef, symbolKind: string, rot: number, flip: boolean, lines: string[], force?: 'N' | 'E'): { w: number; h: number; layout: PartLayout } {
  const o = orient(def, rot, flip);
  const used = new Set(o.pins.map((p) => p.side));
  const labelSide: 'N' | 'S' | 'E' = force ? force : !used.has('E') ? 'E' : !used.has('N') ? 'N' : !used.has('S') ? 'S' : 'E';
  const text = lines.filter(Boolean);
  const m = text.length ? measureLabel(text.join('\n'), LABEL_FS) : { width: 0, height: 0, lineHeight: 14 };
  const lh = Math.round(LABEL_FS * 1.3);
  const lw = Math.ceil(m.width), lhTotal = text.length * lh;
  let w = o.width, h = o.height, symX = 0, symY = 0, labelX = 0, labelY = 0, anchor: 'start' | 'middle' = 'middle';
  if (!text.length) { /* bare symbol */ }
  else if (labelSide === 'E') {
    w = o.width + 8 + lw; h = Math.max(o.height, lhTotal);
    symY = (h - o.height) / 2;
    const crowded = used.has('E');   // output wire leaves E: keep the label clear of it, top-right
    labelX = o.width + 8; labelY = crowded ? lh * 0.8 - 4 : (h - lhTotal) / 2 + lh * 0.8; anchor = 'start';
  } else if (labelSide === 'N') {
    w = Math.max(o.width, lw); h = o.height + lhTotal + 4;
    symX = (w - o.width) / 2; symY = lhTotal + 4;
    labelX = w / 2; labelY = lh * 0.8; anchor = 'middle';
  } else {
    w = Math.max(o.width, lw); h = o.height + lhTotal + 4;
    symX = (w - o.width) / 2; symY = 0;
    labelX = w / 2; labelY = o.height + 4 + lh * 0.8; anchor = 'middle';
  }
  const layout: PartLayout = {
    symbol: symbolKind, rot, flip, symX, symY, symW: o.width, symH: o.height,
    transform: o.transform,
    pins: o.pins.map((p) => ({ name: p.name, x: p.x + symX, y: p.y + symY, side: p.side })),
    labelSide, labelX, labelY, anchor, lines: text,
  };
  return { w, h, layout };
}

function nodeBase(id: string, label: string, w: number, h: number, data: Record<string, unknown>): IRNode {
  return {
    id, label, shape: ShapeType.RECTANGLE, position: { x: 0, y: 0 }, size: { width: w, height: h },
    style: {}, ports: [], classList: [], collapsed: false, data,
  } as IRNode;
}

/** Build the shared IR from a circuit model. */
export function circuitToIR(model: CircuitModel, id = 'circuit-1'): DiagramIR {
  const nodes: IRNode[] = [];
  const edges: IREdge[] = [];
  const partById = new Map<string, CircuitPart>();
  const rotateOf = new Map<string, number>(), flipOf = new Set<string>();
  const rankIn = new Set<string>(), rankOut = new Set<string>();
  for (const h of model.hints) {
    if (h.op === 'rotate') rotateOf.set(h.ref.toLowerCase(), h.deg);
    else if (h.op === 'flip') flipOf.add(h.ref.toLowerCase());
    else for (const r of h.refs) (h.where === 'in' ? rankIn : rankOut).add(r.toLowerCase());
  }

  for (const p of model.parts) {
    partById.set(p.ref, p);
    const def = symbolFor(p.kind, p.pins, p.modelType ?? '', p.value);
    const rot = rotateOf.get(p.ref.toLowerCase()) ?? 0;
    const flip = flipOf.has(p.ref.toLowerCase());
    const valueLine = p.modelType && !p.value.toUpperCase().includes(p.modelType.toUpperCase()) ? `${p.value} (${p.modelType})` : p.value;
    const { w, h, layout } = partLayout(def, def.kind === p.kind ? p.kind : 'X', rot, flip, [p.ref, valueLine]);
    const rank = rankIn.has(p.ref.toLowerCase()) ? 'in' : rankOut.has(p.ref.toLowerCase()) ? 'out' : undefined;
    nodes.push(nodeBase(p.ref, p.ref, w, h, { role: 'part', kind: p.kind, value: p.value, modelType: p.modelType, pins: p.pins, circuit: layout, rank }));
  }

  const addEdge = (src: string, srcPin: string | undefined, tgt: string, tgtPin: string | undefined, net: string) => {
    edges.push({
      id: `w${edges.length}-${net}`, sourceId: src, targetId: tgt, style: { stroke: '#1f2933', strokeWidth: 1.6 } as any,
      routing: EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [],
      data: { role: 'wire', net, srcPin, tgtPin, arrowType: 'none' },
    } as IREdge);
  };

  // A rail label goes where the part's body is not: beside the bar for pins on the
  // N/S sides, above it for pins on the E/W sides.
  const sideOfPin = (ref: string, pin: string): PinSide | undefined =>
    ((nodes.find((n) => n.id === ref)?.data as any)?.circuit as PartLayout | undefined)?.pins.find((q) => q.name === pin)?.side;
  const power = new Set(model.powerNets.map((n) => n.toLowerCase()));
  let sym = 0;
  for (const [net, members] of Object.entries(model.nets)) {
    const pins = members.map((m) => { const i = m.lastIndexOf('.'); return { ref: m.slice(0, i), pin: m.slice(i + 1) }; })
      .filter((m) => partById.has(m.ref));
    if (power.has(net.toLowerCase())) {
      const ground = isGroundName(net);
      for (const m of pins) {
        const sid = `pwr${sym++}`;
        const def = SYMBOLS[ground ? 'GND' : 'VCC'];
        const { w, h, layout } = partLayout(def, def.kind, 0, false, ground ? [] : [net], sideOfPin(m.ref, m.pin) === 'N' || sideOfPin(m.ref, m.pin) === 'S' ? 'E' : 'N');
        nodes.push(nodeBase(sid, ground ? 'GND' : net, w, h, { role: 'power', kind: def.kind, net, circuit: layout }));
        // Rails feed the pin; ground receives it, so layered layout puts
        // supplies on the left and grounds on the right.
        if (ground) addEdge(m.ref, m.pin, sid, '1', net); else addEdge(sid, '1', m.ref, m.pin, net);
      }
      continue;
    }
    if (pins.length < 2) continue;
    if (pins.length === 2) { addEdge(pins[0].ref, pins[0].pin, pins[1].ref, pins[1].pin, net); continue; }
    const jid = `j-${net}`;
    nodes.push(nodeBase(jid, '', 0, 0, { role: 'junction', net }));
    for (const m of pins) addEdge(m.ref, m.pin, jid, undefined, net);
  }

  return {
    id, type: DiagramType.CIRCUIT, title: model.title || 'Circuit',
    nodes, edges, groups: [], layers: [],
    metadata: { circuitWarnings: model.warnings, partCount: model.parts.length },
  } as DiagramIR;
}
