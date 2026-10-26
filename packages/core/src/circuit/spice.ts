// =============================================================================
// SelDiA — SPICE netlist importer
// =============================================================================
// Subset: R C L V I D Q M J X (+ E/G as generic boxes), .subckt/.ends, .model,
// `*` comments, `;` inline comments, `+` continuation, SI suffixes left in the
// value text. Everything else (.print .options .tran .ac .op ...) is accepted
// and ignored. First line is the title unless the caller already has one.
//
// Layout hints ride in comments so the netlist stays valid SPICE:
//   * @seldia rotate R1 90
//   * @seldia flip Q1
//   * @seldia rank in V1 R1      (first column)   / rank out RL (last column)
// =============================================================================

import type { CircuitModel, CircuitPart, CircuitHint } from './model.js';
import { isGroundName, isRailName, MAX_PARTS } from './model.js';

const FIXED_PINS: Record<string, string[]> = {
  R: ['1', '2'], C: ['1', '2'], L: ['1', '2'],
  V: ['+', '-'], I: ['+', '-'],
  D: ['anode', 'cathode'], Q: ['C', 'B', 'E'], M: ['D', 'G', 'S', 'B'], J: ['D', 'G', 'S'],
};

export interface SpiceOptions {
  /** The caller already extracted the title; the first line is an element. */
  hasTitle?: boolean;
}

/** Net-name canonicaliser: case-insensitive, `gnd` is node `0`. */
class NetNames {
  private canon = new Map<string, string>();
  of(raw: string): string {
    if (isGroundName(raw) && /^(0|gnd)$/i.test(raw)) return '0';
    const k = raw.toLowerCase();
    const have = this.canon.get(k);
    if (have) return have;
    this.canon.set(k, raw);
    return raw;
  }
}

export function parseSpice(source: string, opts: SpiceOptions = {}): CircuitModel {
  const lines = source.replace(/\r/g, '').split('\n');
  const model: CircuitModel = { parts: [], nets: {}, powerNets: [], hints: [], warnings: [] };
  let i = 0;
  if (!opts.hasTitle) {
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i < lines.length) model.title = lines[i++].trim();
  }

  // Logical lines: merge `+` continuations, strip comments, keep hints.
  const logical: string[] = [];
  for (; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (t === '') continue;
    if (t.startsWith('*')) {
      const h = /^\*\s*@seldia\s+(.*)$/i.exec(t);
      if (h) addHint(model, h[1], model.warnings);
      continue;
    }
    const body = t.replace(/\s*(;|\$\s).*$/, '').trim();
    if (body === '') continue;
    if (body.startsWith('+') && logical.length) logical[logical.length - 1] += ' ' + body.slice(1).trim();
    else logical.push(body);
  }

  // Pass 1: .subckt pin lists and .model types.
  const subckts = new Map<string, string[]>();
  const modelTypes = new Map<string, string>();
  for (const l of logical) {
    const tk = l.split(/\s+/);
    const d = tk[0].toLowerCase();
    if (d === '.subckt' && tk.length >= 2) subckts.set(tk[1].toLowerCase(), tk.slice(2).filter((x) => !x.includes('=')));
    else if (d === '.model' && tk.length >= 3) modelTypes.set(tk[1].toLowerCase(), tk[2].replace(/\(.*$/, '').toUpperCase());
  }

  // Pass 2: elements outside subcircuit bodies.
  const names = new NetNames();
  const pinsOfNet = new Map<string, string[]>();
  const order: string[] = [];
  let depth = 0;
  const attach = (rawNet: string, ref: string, pin: string) => {
    const net = names.of(rawNet);
    if (!pinsOfNet.has(net)) { pinsOfNet.set(net, []); order.push(net); }
    pinsOfNet.get(net)!.push(`${ref}.${pin}`);
  };

  for (const l of logical) {
    const tk = l.replace(/\s+/g, ' ').split(' ');
    const first = tk[0];
    if (first.startsWith('.')) {
      const d = first.toLowerCase();
      if (d === '.subckt') depth++;
      else if (d === '.ends') depth = Math.max(0, depth - 1);
      else if (d === '.end') break;
      continue;
    }
    if (depth > 0) continue;
    const kind = first[0].toUpperCase();
    const args = tk.slice(1);
    const plain = args.filter((a) => !a.includes('=') || /^[A-Za-z]+\(/.test(a));
    let part: CircuitPart | undefined;
    let nodesOf: string[] = [];

    if (kind === 'R' || kind === 'C' || kind === 'L' || kind === 'V' || kind === 'I') {
      if (args.length < 2) { model.warnings.push(`${first}: needs two nodes; skipped`); continue; }
      nodesOf = args.slice(0, 2);
      part = { ref: first, kind, pins: FIXED_PINS[kind], value: args.slice(2).join(' ') };
    } else if (kind === 'D') {
      if (args.length < 2) { model.warnings.push(`${first}: needs two nodes; skipped`); continue; }
      nodesOf = args.slice(0, 2);
      part = { ref: first, kind, pins: FIXED_PINS.D, value: args[2] ?? '' };
    } else if (kind === 'Q' || kind === 'J') {
      const n = 3;
      const hasSub = kind === 'Q' && plain.length >= 5;
      if (plain.length < n) { model.warnings.push(`${first}: needs ${n} nodes; skipped`); continue; }
      nodesOf = plain.slice(0, n);
      part = { ref: first, kind, pins: FIXED_PINS[kind], value: plain[hasSub ? 4 : 3] ?? '' };
    } else if (kind === 'M') {
      if (plain.length < 4) { model.warnings.push(`${first}: needs 4 nodes; skipped`); continue; }
      nodesOf = plain.slice(0, 4);
      part = { ref: first, kind, pins: FIXED_PINS.M, value: plain[4] ?? '' };
    } else if (kind === 'X') {
      if (plain.length < 2) { model.warnings.push(`${first}: subcircuit call needs nodes and a name; skipped`); continue; }
      const sub = plain[plain.length - 1];
      nodesOf = plain.slice(0, -1);
      const def = subckts.get(sub.toLowerCase());
      const pins = def && def.length === nodesOf.length ? def : nodesOf.map((_, k) => `p${k + 1}`);
      part = { ref: first, kind: 'X', pins, value: sub };
    } else if (kind === 'E' || kind === 'G') {
      if (plain.length < 4) { model.warnings.push(`${first}: needs 4 nodes; skipped`); continue; }
      nodesOf = plain.slice(0, 4);
      part = { ref: first, kind: 'X', pins: ['out+', 'out-', 'in+', 'in-'], value: `${kind === 'E' ? 'VCVS' : 'VCCS'} ${plain.slice(4).join(' ')}`.trim() };
    } else {
      model.warnings.push(`${first}: unsupported element type "${kind}"; skipped`);
      continue;
    }

    const mt = modelTypes.get(part.value.toLowerCase());
    if (mt) part.modelType = mt;
    model.parts.push(part);
    nodesOf.forEach((net, k) => attach(net, part!.ref, part!.pins[k]));
  }

  for (const net of order) model.nets[net] = pinsOfNet.get(net)!;
  model.powerNets = order.filter((n) => isGroundName(n) || isRailName(n));
  if (model.parts.length > MAX_PARTS) {
    model.warnings.push(`${model.parts.length} parts exceeds the ${MAX_PARTS}-part schematic budget; layout may be slow or cluttered`);
  }
  return model;
}

function addHint(model: CircuitModel, text: string, warnings: string[]): void {
  const t = text.trim().split(/\s+/);
  const op = (t[0] || '').toLowerCase();
  let h: CircuitHint | undefined;
  if (op === 'rotate' && t.length >= 3 && Number.isFinite(Number(t[2]))) h = { op: 'rotate', ref: t[1], deg: Number(t[2]) };
  else if (op === 'flip' && t.length >= 2) h = { op: 'flip', ref: t[1] };
  else if (op === 'rank' && t.length >= 3 && (t[1] === 'in' || t[1] === 'out')) h = { op: 'rank', where: t[1], refs: t.slice(2) };
  if (h) model.hints.push(h); else warnings.push(`unrecognised @seldia hint: ${text.trim()}`);
}
