// =============================================================================
// SelDiA — Circuit symbol interface (+ placeholder artwork)
// =============================================================================
// A symbol is drawn in its own local box (0..width, 0..height, y down) in its
// DEFAULT orientation. Pin positions are the contract with the layout: ELK gets
// them as fixed ports, wires end exactly on them. IEEE-style artwork (dev A); generic boxes
// carry unknown parts and pins sit on a 10px grid.
// =============================================================================

export type PinSide = 'N' | 'S' | 'E' | 'W';

export interface SymbolPin {
  /** Pin name as the parsers emit it (`1`, `+`, `anode`, `C`, `D`, ...). */
  name: string;
  /** Position in the symbol's local box. */
  x: number;
  y: number;
  /** Which side of the box the wire leaves through. */
  side: PinSide;
}

export interface DrawContext {
  stroke: string;
  fill: string;
  strokeWidth: number;
  /** Text colour for any glyph the artwork draws. */
  text: string;
}

export interface SymbolDef {
  kind: string;
  width: number;
  height: number;
  pins: SymbolPin[];
  /** SVG fragment in local coordinates. */
  draw(ctx: DrawContext): string;
}

function box(def: { kind: string; width: number; height: number; pins: SymbolPin[]; glyph: string; inset?: number }): SymbolDef {
  const { width: w, height: h, pins } = def;
  return {
    kind: def.kind, width: w, height: h, pins,
    draw(c) {
      const inset = def.inset ?? 8;
      let s = '';
      // Pin stubs from each pin to the body outline.
      for (const p of pins) {
        const bx = p.side === 'W' ? inset : p.side === 'E' ? w - inset : p.x;
        const by = p.side === 'N' ? inset : p.side === 'S' ? h - inset : p.y;
        s += `<line x1="${p.x}" y1="${p.y}" x2="${bx}" y2="${by}" stroke="${c.stroke}" stroke-width="${c.strokeWidth}"/>`;
      }
      s += `<rect x="${inset}" y="${inset}" width="${w - 2 * inset}" height="${h - 2 * inset}" rx="2" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${c.strokeWidth}"/>`;
      s += `<text x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="${c.text}" font-family="sans-serif">${def.glyph}</text>`;
      return s;
    },
  };
}

const P = (name: string, x: number, y: number, side: PinSide): SymbolPin => ({ name, x, y, side });

// ── IEEE-style artwork ──────────────────────────────────────────────────────
// Every pin sits on the 10px grid and every body is built from plain strokes
// (no <text>), so the drawing survives mirroring by `orient` and reads the same
// whether or not the renderer later runs it through Rough.

type Ctx = DrawContext;
const sw = (c: Ctx, k = 1) => `stroke="${c.stroke}" stroke-width="${c.strokeWidth * k}" stroke-linecap="round" stroke-linejoin="round"`;
const path = (c: Ctx, d: string, fill = 'none', k = 1) => `<path d="${d}" fill="${fill}" ${sw(c, k)}/>`;
const circle = (c: Ctx, cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c.fill}" ${sw(c)}/>`;
const f = (n: number) => String(Math.round(n * 100) / 100);
/** Solid arrowhead whose tip is (x,y), pointing along (dx,dy). */
function head(c: Ctx, x: number, y: number, dx: number, dy: number, len = 7, half = 3): string {
  const m = Math.hypot(dx, dy) || 1, ux = dx / m, uy = dy / m;
  const bx = x - ux * len, by = y - uy * len;
  return `<path d="M${f(x)} ${f(y)}L${f(bx - uy * half)} ${f(by + ux * half)}L${f(bx + uy * half)} ${f(by - ux * half)}Z" fill="${c.stroke}" stroke="${c.stroke}" stroke-width="1" stroke-linejoin="round"/>`;
}
const plus = (c: Ctx, x: number, y: number, r = 3) => path(c, `M${x - r} ${y}H${x + r}M${x} ${y - r}V${y + r}`, 'none', 0.8);
const minus = (c: Ctx, x: number, y: number, r = 3) => path(c, `M${x - r} ${y}H${x + r}`, 'none', 0.8);

const def2 = (kind: string, width: number, height: number, pins: SymbolPin[], draw: (c: Ctx) => string): SymbolDef => ({ kind, width, height, pins, draw });
const h2 = (w: number, h: number, a: string, b: string) => [P(a, 0, h / 2, 'W'), P(b, w, h / 2, 'E')];
const v2 = (w: number, h: number, a: string, b: string) => [P(a, w / 2, 0, 'N'), P(b, w / 2, h, 'S')];

const resistor = def2('R', 60, 20, h2(60, 20, '1', '2'),
  (c) => path(c, 'M0 10H15L20 2L25 18L30 2L35 18L40 2L45 10H60'));
const capacitor = def2('C', 40, 20, h2(40, 20, '1', '2'),
  (c) => path(c, 'M0 10H17M23 10H40') + path(c, 'M17 2V18', 'none', 1.3) + path(c, 'M23 2V18', 'none', 1.3));
const capacitorPolarised = def2('C', 40, 20, h2(40, 20, '1', '2'),
  (c) => path(c, 'M0 10H17M24 10H40') + path(c, 'M17 2V18', 'none', 1.3) + path(c, 'M24 2Q29 10 24 18', 'none', 1.3) + plus(c, 11, 4, 2.5));
const inductor = def2('L', 60, 20, h2(60, 20, '1', '2'),
  (c) => path(c, 'M0 10H12a6 6 0 0 1 12 0a6 6 0 0 1 12 0a6 6 0 0 1 12 0H60'));
const vsource = def2('V', 40, 60, v2(40, 60, '+', '-'),
  (c) => path(c, 'M20 0V16M20 44V60') + circle(c, 20, 30, 14) + plus(c, 20, 23) + minus(c, 20, 37));
const vsourceAC = def2('V', 40, 60, v2(40, 60, '+', '-'),
  (c) => path(c, 'M20 0V16M20 44V60') + circle(c, 20, 30, 14) + path(c, 'M12 30q4 -8 8 0t8 0'));
const isource = def2('I', 40, 60, v2(40, 60, '+', '-'),
  (c) => path(c, 'M20 0V16M20 44V60') + circle(c, 20, 30, 14) + path(c, 'M20 40V24') + head(c, 20, 19, 0, -1, 8, 3.5));
const diode = def2('D', 50, 20, h2(50, 20, 'anode', 'cathode'),
  (c) => path(c, 'M0 10H15M33 10H50') + path(c, 'M15 2V18L33 10Z', c.fill) + path(c, 'M33 2V18', 'none', 1.3));
const zener = def2('D', 50, 20, h2(50, 20, 'anode', 'cathode'),
  (c) => path(c, 'M0 10H15M33 10H50') + path(c, 'M15 2V18L33 10Z', c.fill) + path(c, 'M29 4L33 2V18L37 16', 'none', 1.3));
const led = def2('D', 50, 40, h2(50, 40, 'anode', 'cathode'),
  (c) => path(c, 'M0 20H15M33 20H50') + path(c, 'M15 12V28L33 20Z', c.fill) + path(c, 'M33 12V28', 'none', 1.3)
    + path(c, 'M22 10L30 2') + head(c, 31, 1, 1, -1, 5, 2.5) + path(c, 'M29 14L37 6') + head(c, 38, 5, 1, -1, 5, 2.5));

/** Bipolar transistor. NPN: emitter arrow points out; PNP: points in. */
function bjt(pnp: boolean): SymbolDef {
  return def2('Q', 50, 60, [P('C', 40, 0, 'N'), P('B', 0, 30, 'W'), P('E', 40, 60, 'S')], (c) =>
    path(c, 'M0 30H20') + path(c, 'M20 16V44', 'none', 1.6) + path(c, 'M20 25L40 12V0M20 35L40 48V60')
    + (pnp ? head(c, 22, 36.2, -20, -12, 8, 3.5) : head(c, 38.6, 47.2, 20, 12, 8, 3.5)));
}
/** N-channel JFET (gate arrow in). */
const jfet = def2('J', 50, 60, [P('D', 40, 0, 'N'), P('G', 0, 30, 'W'), P('S', 40, 60, 'S')], (c) =>
  path(c, 'M0 30H22') + head(c, 22, 30, 1, 0, 7, 3.5) + path(c, 'M24 12V48', 'none', 1.6) + path(c, 'M24 12H40V0M24 48H40V60'));
/** Enhancement MOSFET with broken channel and body pin (pins D,G,S,B). */
function mosfet(p: boolean): SymbolDef {
  return def2('M', 50, 60, [P('D', 40, 0, 'N'), P('G', 0, 30, 'W'), P('S', 40, 60, 'S'), P('B', 50, 30, 'E')], (c) =>
    path(c, 'M0 30H14') + path(c, 'M14 16V44', 'none', 1.6)
    + path(c, 'M22 12V20M22 26V34M22 40V48', 'none', 1.6)
    + path(c, 'M22 16H40V0M22 44H40V60') + path(c, 'M22 30H50')
    + (p ? head(c, 34, 30, 1, 0, 7, 3.5) : head(c, 22, 30, -1, 0, 7, 3.5)));
}

function ground(): SymbolDef {
  return def2('GND', 20, 20, [P('1', 10, 0, 'N')], (c) => path(c, 'M10 0V10M0 10H20M4 14H16M8 18H12'));
}
function rail(kind: string): SymbolDef {
  return def2(kind, 20, 20, [P('1', 10, 20, 'S')], (c) => path(c, 'M10 20V8M2 8H18', 'none', 1.2));
}

/** Op-amp triangle. `pinNames` order: in+, in-, out[, V+, V-]. */
export function opampSymbol(pinNames: string[]): SymbolDef {
  const [pp, pm, po, vp, vm] = pinNames;
  const pins = [P(pp, 0, 20, 'W'), P(pm, 0, 40, 'W'), P(po, 60, 30, 'E')];
  if (vp !== undefined && vm !== undefined) pins.push(P(vp, 30, 0, 'N'), P(vm, 30, 60, 'S'));
  return def2('X', 60, 60, pins, (c) =>
    path(c, 'M10 0V60L60 30Z', c.fill, 1.2) + path(c, 'M0 20H10M0 40H10')
    + plus(c, 17, 20, 3) + minus(c, 17, 40, 3)
    + (pins.length > 3 ? path(c, 'M30 0V12M30 60V48') : ''));
}

export const SYMBOLS: Record<string, SymbolDef> = {
  R: resistor, C: capacitor, L: inductor, D: diode, V: vsource, I: isource,
  Q: bjt(false), J: jfet, M: mosfet(false),
  GND: ground(), VCC: rail('VCC'), VDD: rail('VDD'),
};

/** Variants picked by the part's model type / value (`.model Q2N NPN`, "LED"...). */
export const SYMBOL_VARIANTS: Record<string, SymbolDef> = {
  CPOL: capacitorPolarised, VAC: vsourceAC, LED: led, ZENER: zener,
  NPN: SYMBOLS.Q, PNP: bjt(true), NMOS: SYMBOLS.M, PMOS: mosfet(true),
};

/** Generic box for a subcircuit / unknown part: pins split over W and E. */
export function genericSymbol(kind: string, pinNames: string[]): SymbolDef {
  const n = pinNames.length;
  const left = Math.ceil(n / 2), right = n - left;
  const rows = Math.max(left, right, 1);
  const h = rows * 20 + 20, w = 80;
  const pins: SymbolPin[] = [];
  pinNames.forEach((name, i) => {
    if (i < left) pins.push(P(name, 0, 20 + i * 20, 'W'));
    else pins.push(P(name, w, 20 + (i - left) * 20, 'E'));
  });
  const def = box({ kind, width: w, height: h, glyph: kind, inset: 10, pins });
  const draw = def.draw;
  return {
    ...def,
    draw: (c) => draw(c) + pinNames.map((nm, i) => {
      const p = pins[i];
      const tx = p.side === 'W' ? p.x + 15 : p.x - 15;
      return `<text x="${tx}" y="${p.y + 3}" text-anchor="${p.side === 'W' ? 'start' : 'end'}" font-size="8" fill="${c.text}" font-family="sans-serif">${nm.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
    }).join(''),
  };
}

const OPAMP_ROLE: Array<RegExp> = [/^(in)?\+$|^inp$|^in\+$|^noninv/i, /^(in)?-$|^inn$|^in-$|^inv/i, /^out/i, /^(v\+|vcc|vdd|vp|vpos)$/i, /^(v-|vee|vss|vm|vneg)$/i];

/** Symbol for a part. Parts whose pin list doesn't fit the stock symbol
 *  (a 5-pin "R", an `X` subcircuit) get a generic box carrying their own pins;
 *  an `X` with op-amp-shaped pin names gets the triangle. `modelType` / `value`
 *  select polarity and flavour (NPN/PNP, NMOS/PMOS, LED, ZENER, polarised C, AC). */
export function symbolFor(kind: string, pinNames: string[], modelType = '', value = ''): SymbolDef {
  if (kind === 'X' && (pinNames.length === 3 || pinNames.length === 5)) {
    const ok = pinNames.every((n, i) => OPAMP_ROLE[i].test(n));
    if (ok) return opampSymbol(pinNames);
  }
  const mt = modelType.toUpperCase();
  const v = value.toUpperCase();
  let variant: SymbolDef | undefined;
  if (kind === 'Q' || kind === 'M') variant = SYMBOL_VARIANTS[mt];
  else if (kind === 'D') variant = /LED/.test(mt + v) ? SYMBOL_VARIANTS.LED : /ZENER|^DZ|^1N47/.test(mt + v) ? SYMBOL_VARIANTS.ZENER : undefined;
  else if (kind === 'C' && /^(POL|ELEC|CP)/.test(mt)) variant = SYMBOL_VARIANTS.CPOL;
  else if (kind === 'V' && /^(AC|SIN)/.test(v)) variant = SYMBOL_VARIANTS.VAC;
  const stock = variant && variant.kind === kind ? variant : SYMBOLS[kind];
  if (stock && (kind === 'GND' || kind === 'VCC' || kind === 'VDD')) return stock;
  if (stock && stock.pins.length === pinNames.length && stock.pins.every((p, i) => p.name === pinNames[i])) return stock;
  return genericSymbol(kind, pinNames);
}

// ── Orientation ─────────────────────────────────────────────────────────────

export interface Oriented {
  /** Oriented bounding box of the symbol. */
  width: number;
  height: number;
  pins: SymbolPin[];
  /** SVG transform that maps the symbol's local drawing onto the oriented box
   *  (relative to the box's top-left). */
  transform: string;
}

const ROT_SIDE: Record<PinSide, PinSide[]> = { N: ['N', 'E', 'S', 'W'], E: ['E', 'S', 'W', 'N'], S: ['S', 'W', 'N', 'E'], W: ['W', 'N', 'E', 'S'] };

/** Flip (mirror top-bottom) first, then rotate clockwise by `rot` degrees. */
export function orient(def: SymbolDef, rot: number, flip: boolean): Oriented {
  const steps = (((Math.round(rot / 90) % 4) + 4) % 4);
  const w = def.width, h = def.height;
  const W = steps % 2 ? h : w, H = steps % 2 ? w : h;
  const pins = def.pins.map((p) => {
    let x = p.x, y = flip ? h - p.y : p.y;
    let side: PinSide = flip ? (p.side === 'N' ? 'S' : p.side === 'S' ? 'N' : p.side) : p.side;
    let dx = x - w / 2, dy = y - h / 2;
    for (let i = 0; i < steps; i++) { const t = dx; dx = -dy; dy = t; }
    side = ROT_SIDE[side][steps];
    return { name: p.name, x: round(dx + W / 2), y: round(dy + H / 2), side };
  });
  const transform = `translate(${W / 2} ${H / 2}) rotate(${steps * 90}) translate(${-w / 2} ${-h / 2})${flip ? ` translate(0 ${h}) scale(1 -1)` : ''}`;
  return { width: W, height: H, pins, transform };
}

function round(n: number): number { return Math.round(n * 100) / 100; }
