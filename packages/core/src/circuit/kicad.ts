// =============================================================================
// SelDiA — KiCad netlist importer (what SKiDL's generate_netlist() writes)
// =============================================================================
//   (export (version "E")
//     (components (comp (ref "R1") (value "10k") (libsource (lib "Device") (part "R")) ...))
//     (nets (net (code "1") (name "VCC") (node (ref "R1") (pin "1") (pinfunction "~")) ...)))
// =============================================================================

import type { CircuitModel, CircuitPart } from './model.js';
import { isGroundName, isRailName, MAX_PARTS } from './model.js';

type Sx = string | Sx[];

export function isKicadNetlist(src: string): boolean { return /^\s*\(\s*export\b/.test(src); }

function readSexp(src: string): Sx {
  let i = 0;
  const skip = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const atom = (): string => {
    if (src[i] === '"') {
      let s = ''; i++;
      while (i < src.length && src[i] !== '"') { if (src[i] === '\\' && i + 1 < src.length) i++; s += src[i++]; }
      i++;
      return s;
    }
    const st = i;
    while (i < src.length && !/[\s()]/.test(src[i])) i++;
    return src.slice(st, i);
  };
  const list = (): Sx => {
    i++; // (
    const out: Sx[] = [];
    for (;;) {
      skip();
      if (i >= src.length) return out;
      if (src[i] === ')') { i++; return out; }
      out.push(src[i] === '(' ? list() : atom());
    }
  };
  skip();
  return src[i] === '(' ? list() : atom();
}

const head = (x: Sx): string => (Array.isArray(x) && typeof x[0] === 'string' ? x[0] : '');
const kids = (x: Sx, name: string): Sx[][] => (Array.isArray(x) ? (x.filter((c) => head(c) === name) as Sx[][]) : []);
const text = (x: Sx | undefined, name: string): string => {
  const c = Array.isArray(x) ? kids(x, name)[0] : undefined;
  return c && typeof c[1] === 'string' ? c[1] : '';
};

/** Symbol kind and canonical pin list for a KiCad part, from its ref prefix and lib part. */
function classify(ref: string, libPart: string): { kind: string; pins?: string[] } {
  const p = libPart.toUpperCase();
  const pre = (/^[A-Za-z]+/.exec(ref)?.[0] ?? '').toUpperCase();
  if (pre === 'R' || /^R(_|$)/.test(p)) return { kind: 'R', pins: ['1', '2'] };
  if (pre === 'C' || /^C(P)?(_|$)/.test(p)) return { kind: 'C', pins: ['1', '2'] };
  if (pre === 'L' || /^L(_|$)/.test(p)) return { kind: 'L', pins: ['1', '2'] };
  if (pre === 'D' || pre === 'LED' || /^(LED|D)(_|$)/.test(p)) return { kind: 'D', pins: ['cathode', 'anode'] }; // KiCad: pin 1 = K, pin 2 = A
  if (pre === 'Q' || /^Q_/.test(p)) return /MOS|FET/.test(p) ? { kind: 'M' } : { kind: 'Q' };
  if (pre === 'V' || pre === 'BT') return { kind: 'V', pins: ['+', '-'] };
  return { kind: 'X' };
}

export function parseKicadNetlist(source: string): CircuitModel {
  const model: CircuitModel = { parts: [], nets: {}, powerNets: [], hints: [], warnings: [] };
  const root = readSexp(source);
  if (head(root) !== 'export') { model.warnings.push('not a KiCad netlist (expected "(export ...)")'); return model; }

  const info = new Map<string, { kind: string; value: string; canon?: string[]; libPart: string }>();
  for (const comps of kids(root, 'components')) {
    for (const c of kids(comps, 'comp')) {
      const ref = text(c, 'ref');
      const lib = kids(c, 'libsource')[0];
      const libPart = lib ? text(lib, 'part') : '';
      const cl = classify(ref, libPart);
      info.set(ref, { kind: cl.kind, value: text(c, 'value'), canon: cl.pins, libPart });
    }
  }

  // Collect pins per ref from the nets.
  const pinsSeen = new Map<string, Map<string, string>>(); // ref -> pin number -> function name
  type Member = { ref: string; num: string };
  const nets: Array<{ name: string; members: Member[] }> = [];
  for (const netsNode of kids(root, 'nets')) {
    for (const n of kids(netsNode, 'net')) {
      const name = text(n, 'name').replace(/^\//, '') || `N${text(n, 'code')}`;
      const members: Member[] = [];
      for (const nd of kids(n, 'node')) {
        const ref = text(nd, 'ref'), num = text(nd, 'pin');
        if (!ref) continue;
        members.push({ ref, num });
        if (!pinsSeen.has(ref)) pinsSeen.set(ref, new Map());
        const fn = text(nd, 'pinfunction');
        pinsSeen.get(ref)!.set(num, fn && fn !== '~' ? fn : '');
      }
      nets.push({ name, members });
    }
  }

  // Resolve each part's pin names; build a (ref,number) -> pin-name map.
  const pinName = new Map<string, string>();
  for (const [ref, meta] of info) {
    const seen = pinsSeen.get(ref) ?? new Map<string, string>();
    const nums = [...seen.keys()].sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
    let names: string[];
    if (meta.canon && meta.canon.length === 2) {
      // Two-terminal parts: pin 1 / pin 2 map positionally.
      names = meta.canon; nums.splice(0, nums.length, '1', '2');
    } else if (meta.kind === 'Q' || meta.kind === 'M') {
      const want = meta.kind === 'Q' ? ['C', 'B', 'E'] : ['D', 'G', 'S', 'B'];
      const fns = nums.map((n) => seen.get(n) ?? '');
      const byFn = new Map(fns.map((f, k) => [f.toUpperCase(), nums[k]]));
      if (want.slice(0, 3).every((w) => byFn.has(w))) {
        // Pin functions name the terminals: map them regardless of numbering.
        const used = want.filter((w) => byFn.has(w));
        used.forEach((w) => pinName.set(`${ref}#${byFn.get(w)}`, w));
        model.parts.push({ ref, kind: meta.kind, pins: used, value: meta.value });
        continue;
      }
      names = want.slice(0, nums.length);
      if (nums.length !== want.length && !(meta.kind === 'Q' && nums.length === 3)) names = nums;
    } else {
      names = nums.map((n) => seen.get(n) || n);
    }
    nums.forEach((n, k) => pinName.set(`${ref}#${n}`, names[k] ?? n));
    const part: CircuitPart = { ref, kind: meta.kind, pins: names.slice(0, nums.length), value: meta.value };
    model.parts.push(part);
  }

  for (const net of nets) {
    const mem = net.members.map((m) => `${m.ref}.${pinName.get(`${m.ref}#${m.num}`) ?? m.num}`);
    if (mem.length) model.nets[net.name] = mem;
  }
  model.powerNets = Object.keys(model.nets).filter((n) => isGroundName(n) || isRailName(n));
  if (model.parts.length > MAX_PARTS) model.warnings.push(`${model.parts.length} parts exceeds the ${MAX_PARTS}-part schematic budget; layout may be slow or cluttered`);
  return model;
}
