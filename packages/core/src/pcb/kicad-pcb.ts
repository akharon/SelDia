// =============================================================================
// SelDiA — KiCad `.kicad_pcb` reader (render subset)
// =============================================================================
// Reads the s-expression subset a board *view* needs: Edge.Cuts outline,
// footprints (pads, silk, reference), tracks, vias, nets. Zones, fills and
// text fonts are out of scope. Coordinates stay in mm, KiCad's y-down frame.
// =============================================================================

export type SExp = string | SExp[];

/** Tokenise + parse into nested arrays; quoted strings lose their quotes. */
export function parseSExp(src: string): SExp {
  const root: SExp[] = [];
  const stack: SExp[][] = [root];
  const re = /\(|\)|"((?:[^"\\]|\\.)*)"|[^\s()"]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const t = m[0], top = stack[stack.length - 1];
    if (t === '(') { const l: SExp[] = []; top.push(l); stack.push(l); }
    else if (t === ')') { if (stack.length > 1) stack.pop(); }
    else top.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : t);
  }
  return root.length === 1 ? root[0] : root;
}

const isList = (x: SExp | undefined): x is SExp[] => Array.isArray(x);
const kids = (n: SExp[], key: string): SExp[][] => n.filter((c): c is SExp[] => isList(c) && c[0] === key);
const kid = (n: SExp[], key: string): SExp[] | undefined => kids(n, key)[0];
const num = (x: SExp | undefined, d = 0): number => { const v = typeof x === 'string' ? parseFloat(x) : NaN; return Number.isFinite(v) ? v : d; };
const str = (x: SExp | undefined, d = ''): string => (typeof x === 'string' ? x : d);
const xy = (n: SExp[] | undefined): [number, number] => (n ? [num(n[1]), num(n[2])] : [0, 0]);

export interface Pt { x: number; y: number }
export interface Pad { num: string; type: string; shape: string; x: number; y: number; rot: number; w: number; h: number; drill: number; layers: string[]; ratio: number }
export interface Line { layer: string; x1: number; y1: number; x2: number; y2: number; width: number }
export interface Circle { layer: string; cx: number; cy: number; r: number; width: number }
export interface Footprint { ref: string; x: number; y: number; rot: number; layer: string; pads: Pad[]; lines: Line[]; circles: Circle[]; refAt?: Pt; refLayer: string; refHidden: boolean }
export interface Track { x1: number; y1: number; x2: number; y2: number; width: number; layer: string; net: string }
export interface Via { x: number; y: number; size: number; drill: number }
export interface Arc { layer: string; start: Pt; mid?: Pt; end: Pt; width: number }
export interface Board {
  lines: Line[]; arcs: Arc[]; circles: Circle[];
  footprints: Footprint[]; tracks: Track[]; vias: Via[];
  nets: Record<string, string>;
}

/** Local footprint offset -> board coordinates (KiCad rotation is CCW on a y-down canvas). */
export function place(fp: { x: number; y: number; rot: number }, lx: number, ly: number): Pt {
  const a = (fp.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: fp.x + lx * c + ly * s, y: fp.y - lx * s + ly * c };
}

function lineOf(n: SExp[]): Line {
  const [x1, y1] = xy(kid(n, 'start')), [x2, y2] = xy(kid(n, 'end'));
  const w = kid(n, 'width') ?? kid(kid(n, 'stroke') ?? [], 'width');   // v6 `(width)` or v7 `(stroke (width))`
  return { layer: str(kid(n, 'layer')?.[1]), x1, y1, x2, y2, width: num(w?.[1], 0.12) };
}
const rectLines = (n: SExp[]): Line[] => {
  const l = lineOf(n);
  return [[l.x1, l.y1, l.x2, l.y1], [l.x2, l.y1, l.x2, l.y2], [l.x2, l.y2, l.x1, l.y2], [l.x1, l.y2, l.x1, l.y1]]
    .map(([x1, y1, x2, y2]) => ({ ...l, x1, y1, x2, y2 }));
};
function circleOf(n: SExp[]): Circle {
  const [cx, cy] = xy(kid(n, 'center')), [ex, ey] = xy(kid(n, 'end'));
  const l = lineOf(n);
  return { layer: l.layer, cx, cy, r: Math.hypot(ex - cx, ey - cy), width: l.width };
}

export function parseKicadPcb(src: string): Board {
  const root = parseSExp(src);
  const b: Board = { lines: [], arcs: [], circles: [], footprints: [], tracks: [], vias: [], nets: {} };
  if (!isList(root)) return b;
  const netName = (x: SExp | undefined, extra?: SExp): string => {
    if (typeof extra === 'string') return extra;       // (net 3 "GND")
    const s = str(x);
    return b.nets[s] ?? s;
  };
  for (const n of root) {
    if (!isList(n)) continue;
    switch (n[0]) {
      case 'net': if (n.length >= 3) b.nets[str(n[1])] = str(n[2]); break;
      case 'gr_line': b.lines.push(lineOf(n)); break;
      case 'gr_rect': b.lines.push(...rectLines(n)); break;
      case 'gr_circle': b.circles.push(circleOf(n)); break;
      case 'gr_arc': {
        const l = lineOf(n), mid = kid(n, 'mid');
        b.arcs.push({ layer: l.layer, start: { x: l.x1, y: l.y1 }, mid: mid ? { x: num(mid[1]), y: num(mid[2]) } : undefined, end: { x: l.x2, y: l.y2 }, width: l.width });
        break;
      }
      case 'segment': {
        const l = lineOf(n);
        b.tracks.push({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, width: num(kid(n, 'width')?.[1], 0.25), layer: l.layer, net: netName(kid(n, 'net')?.[1], kid(n, 'net')?.[2]) });
        break;
      }
      case 'via': { const [x, y] = xy(kid(n, 'at')); b.vias.push({ x, y, size: num(kid(n, 'size')?.[1], 0.8), drill: num(kid(n, 'drill')?.[1], 0.4) }); break; }
      case 'footprint': case 'module': b.footprints.push(parseFootprint(n)); break;
    }
  }
  return b;
}

function parseFootprint(n: SExp[]): Footprint {
  const at = kid(n, 'at');
  const fp: Footprint = {
    ref: '', x: num(at?.[1]), y: num(at?.[2]), rot: num(at?.[3]), layer: str(kid(n, 'layer')?.[1], 'F.Cu'),
    pads: [], lines: [], circles: [], refLayer: 'F.SilkS', refHidden: false,
  };
  for (const c of n) {
    if (!isList(c)) continue;
    const key = c[0];
    if (key === 'fp_text' && c[1] === 'reference' || key === 'property' && c[1] === 'Reference') {
      fp.ref = str(c[2]);
      const a = kid(c, 'at'); if (a) fp.refAt = { x: num(a[1]), y: num(a[2]) };
      fp.refLayer = str(kid(c, 'layer')?.[1], fp.refLayer);
      fp.refHidden = c.includes('hide') || str(kid(c, 'hide')?.[1]) === 'yes';
    } else if (key === 'fp_line') fp.lines.push(lineOf(c));
    else if (key === 'fp_rect') fp.lines.push(...rectLines(c));
    else if (key === 'fp_circle') fp.circles.push(circleOf(c));
    else if (key === 'pad') {
      const a = kid(c, 'at'), size = kid(c, 'size'), dr = kid(c, 'drill');
      const dnum = dr ? num(dr[1] === 'oval' ? dr[2] : dr[1]) : 0;
      fp.pads.push({
        num: str(c[1]), type: str(c[2]), shape: str(c[3]),
        x: num(a?.[1]), y: num(a?.[2]), rot: a?.[3] !== undefined ? num(a[3]) : fp.rot,
        w: num(size?.[1], 1), h: num(size?.[2], num(size?.[1], 1)), drill: dnum,
        layers: (kid(c, 'layers') ?? []).slice(1).map((s) => str(s)), ratio: num(kid(c, 'roundrect_rratio')?.[1], 0.25),
      });
    }
  }
  return fp;
}

/** Bounding box (mm) of the board: Edge.Cuts when present, else all copper. */
export function boardBounds(b: Board): { x: number; y: number; w: number; h: number } {
  const pts: Pt[] = [];
  const edge = (l: { layer: string }) => l.layer === 'Edge.Cuts';
  for (const l of b.lines.filter(edge)) pts.push({ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 });
  for (const a of b.arcs.filter(edge)) pts.push(a.start, a.end, ...(a.mid ? [a.mid] : []));
  for (const c of b.circles.filter(edge)) pts.push({ x: c.cx - c.r, y: c.cy - c.r }, { x: c.cx + c.r, y: c.cy + c.r });
  if (!pts.length) {
    for (const t of b.tracks) pts.push({ x: t.x1, y: t.y1 }, { x: t.x2, y: t.y2 });
    for (const v of b.vias) pts.push(v);
    for (const f of b.footprints) { pts.push({ x: f.x, y: f.y }); for (const p of f.pads) pts.push(place(f, p.x, p.y)); }
  }
  if (!pts.length) return { x: 0, y: 0, w: 10, h: 10 };
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(Math.max(...xs) - x, 1), h: Math.max(Math.max(...ys) - y, 1) };
}
