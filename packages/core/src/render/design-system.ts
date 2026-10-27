// =============================================================================
// SelDiA — Visual Design System
// =============================================================================
// One stable, document-wide visual language so that every diagram — regardless
// of type — reads as coming from the same tool. The strategy is
// "per-type accent over shared neutrals":
//
//   • SHARED NEUTRALS (identical for every diagram type)
//       - font family & the type scale (title / label / meta sizes)
//       - stroke widths (node border, edge, thin divider)
//       - fill lightness, corner radius, sketchy roughness
//       - text color, muted color, edge color, neutral fill
//     These make diagrams recognisably one family.
//
//   • PER-TYPE ACCENT (one signature hue per diagram type)
//       Each diagram type gets a single accent hue. The accent drives the node
//       stroke, the node label color, the compartment header tint and the edge
//       arrowheads. Fills stay a very light tint of the same hue so the palette
//       never turns into a rainbow. Two different diagram types are
//       distinguishable at a glance; two diagrams of the SAME type are
//       identical.
//
//   • SEMANTIC ROLES (shared across every type)
//       A small fixed role→color map for meaning that transcends diagram type:
//       start (green), stop/error (red), decision (amber), external/actor
//       (violet), note (yellow paper). Roles override the type accent only for
//       the specific nodes that carry them, and are drawn from the same
//       restrained palette so harmony is preserved.
//
// Everything is a plain data lookup (no DOM, no theme object plumbing) so the
// synchronous renderer in engine.ts can consult it directly and deterministically.
// =============================================================================

import { DiagramType } from '../ir/types.js';

/** A resolved swatch: everything the renderer needs to draw one node/edge in
 *  a way that is consistent with the rest of the document. */
export interface Swatch {
  /** Node/shape outline color. */
  stroke: string;
  /** Node fill (a very light tint of the accent, or a neutral). */
  fill: string;
  /** Primary text color for a node's label. */
  text: string;
  /** Header/compartment tint base (usually === stroke). */
  accent: string;
}

// ── Palette override (theming without a fork) ──────────────────────────────
// A caller (CLI --theme flag, a custom Theme, or an ad-hoc palette) can swap
// every color this module hands out without touching a renderer function.
// This stays a plain module-level slot (not a parameter threaded through
// every render* call) because those functions are called from many sites
// across engine.ts and custom-renderers.ts and retrofitting a parameter
// everywhere would be a much larger, riskier change for the same effect.
// The engine sets this once per render() call and clears it in a finally
// block, so it never leaks between unrelated compiles.
export interface PaletteOverride {
  /** Overrides every per-type accent swatch with this single stroke/fill/text
   *  triple (accent = stroke). Leave undefined to keep per-type hues. */
  nodeStroke?: string;
  nodeFill?: string;
  nodeText?: string;
  /** Edge stroke color. */
  edgeStroke?: string;
  /** Canvas/page background. */
  background?: string;
  /** Neutral text/muted/fill colors (falls back to the built-in neutrals). */
  neutralText?: string;
  neutralMuted?: string;
  neutralFill?: string;
  /** Card/panel surface — the ground that neutralText is read against. A dark
   *  palette MUST set this alongside neutralText, or renderers that paint a
   *  surface (work-item cards) end up with light text on white. */
  neutralSurface?: string;
}

let activeOverride: PaletteOverride | undefined;

/** Set the active palette override. Call `clearPaletteOverride()` when done
 *  (the engine does this in a finally block around each render). */
export function setPaletteOverride(override: PaletteOverride | undefined): void {
  activeOverride = override;
}

export function clearPaletteOverride(): void {
  activeOverride = undefined;
}

export function getPaletteOverride(): PaletteOverride | undefined {
  return activeOverride;
}

function applyOverride(base: Swatch): Swatch {
  if (!activeOverride) return base;
  const stroke = activeOverride.nodeStroke ?? base.stroke;
  return {
    stroke,
    fill: activeOverride.nodeFill ?? base.fill,
    text: activeOverride.nodeText ?? base.text,
    accent: stroke,
  };
}

// ── Shared neutrals ─────────────────────────────────────────────────────────
// One typographic + geometric contract for every diagram type.
export const DS = {
  /** The single font stack used by every diagram label, everywhere. Single-quoted
   *  (not double-quoted) multi-word names so this can be dropped straight into a
   *  double-quoted SVG attribute without breaking the attribute value. */
  fontFamily: "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif",
  /** Monospace stack for code-ish content (class members, ER columns). */
  monoFamily: "'JetBrains Mono', 'SF Mono', 'Cascadia Code', Consolas, monospace",

  /** Type scale (px). Title = group/section headers, label = node text,
   *  meta = edge labels / secondary text. Fixed so nothing looks off-key. */
  fontSize: { title: 15, label: 14, meta: 12, small: 11 },

  /** Stroke widths (px). One set for the whole system — the tokens lint
   *  rejects any emitted stroke-width outside these values. `halo` is the
   *  canvas-coloured text outline that lifts an edge label off the line under it. */
  stroke: { hairline: 1, divider: 1, edge: 1.5, node: 1.75, emphasis: 2.5, halo: 4 },

  /** Dash patterns (stroke-dasharray). `edge` = dashed edges, `leader` = label leader lines. */
  dash: { edge: '6 4', leader: '3 3' },

  /** Arrowhead length as a multiple of the edge stroke width. */
  arrowScale: 4.5,

  /** Edge label chip: padding around the text, corner radius. */
  chip: { padX: 6, padY: 3, rx: 3 },

  /** Corner radius for rounded orthogonal edge bends (px). */
  bendRadius: 6,

  /** Minimum straight stub before the first / after the last bend (px). */
  portStub: 12,

  /** Corner radius for rectangular nodes (px). */
  radius: 7,

  /** Sketchy roughness — low, so hand-drawn reads as "crafted" not "messy". */
  roughness: 0.9,

  /** Shared neutrals used when a node has no accent/role of its own.
   *  Live getters (not plain fields) so a PaletteOverride set via
   *  setPaletteOverride() is picked up without threading a parameter through
   *  every call site that reads DS.neutral.*. */
  get neutral() {
    const o = activeOverride;
    return {
      text: o?.neutralText ?? '#1f2933',
      muted: o?.neutralMuted ?? '#5b6b7b',
      edge: o?.edgeStroke ?? '#64748b',
      fill: o?.neutralFill ?? '#f6f8fb',
      stroke: '#94a3b8',
      surface: o?.neutralSurface ?? '#ffffff',
    };
  },
} as const;

// ── Per-type signature accent ───────────────────────────────────────────────
// A single hue family per diagram type. `stroke`/`accent` are the mid tone,
// `fill` a very light tint of the same hue, `text` a dark tone of it so labels
// stay legible on the tint. Hues are spread around the wheel but held at a
// matched saturation/lightness so no single diagram screams louder than another.
const TYPE_ACCENTS: Record<string, Swatch> = {
  //                        stroke     fill       text       accent
  flowchart:   swatch('#4f46e5', '#eef0ff', '#312e81'), // indigo
  sequence:    swatch('#0d9488', '#effcfa', '#115e59'), // teal
  class:       swatch('#4338ca', '#eef1ff', '#312e81'), // indigo-violet
  er:          swatch('#0891b2', '#ecfdff', '#155e75'), // cyan
  state:       swatch('#16a34a', '#effdf3', '#166534'), // green
  usecase:     swatch('#7c3aed', '#f5f0ff', '#5b21b6'), // violet
  activity:    swatch('#2563eb', '#eef4ff', '#1e40af'), // blue
  component:   swatch('#0284c7', '#eef7ff', '#075985'), // sky
  deployment:  swatch('#4b5563', '#f3f4f6', '#1f2937'), // slate
  bpmn:        swatch('#c2410c', '#fff4ec', '#7c2d12'), // burnt orange
  dmn:         swatch('#b45309', '#fff8ec', '#78350f'), // amber-brown
  gantt:       swatch('#0369a1', '#eef6ff', '#075985'), // steel blue
  mindmap:     swatch('#9333ea', '#f8f0ff', '#6b21a8'), // purple
  network:     swatch('#0f766e', '#eefbf8', '#115e59'), // deep teal
  gitgraph:    swatch('#db2777', '#fff0f7', '#9d174d'), // pink
  form:        swatch('#475569', '#f4f6f9', '#1e293b'), // neutral slate
  sankey:      swatch('#0e7490', '#ecfdff', '#155e75'), // cyan
  block:       swatch('#525252', '#f5f5f5', '#262626'), // gray
  timeline:    swatch('#7c3aed', '#f5f0ff', '#5b21b6'), // violet
  wireframe:   swatch('#334155', '#f8fafc', '#1e293b'), // slate — deliberately ink-on-paper, not a bright accent, to read as "low-fidelity sketch" rather than a finished UI
  cloud:       swatch('#f59e0b', '#fffbeb', '#78350f'), // amber/orange — AWS-ish warm accent
  mono:        swatch('#111827', '#f9fafb', '#111827'), // near-black
};

// C4 layers share one family so a context/container/component set harmonises.
const C4: Swatch = swatch('#1d4ed8', '#eef3ff', '#1e3a8a');

// Charts share a steel-blue frame; series colors come from CHART_SERIES below.
const CHART: Swatch = swatch('#0369a1', '#eef6ff', '#075985');

/** The signature swatch for a diagram type. Falls back to a neutral indigo so
 *  an unknown/future type still looks like part of the family. */
export function typeSwatch(type: DiagramType | string): Swatch {
  const t = String(type);
  if (t.startsWith('c4')) return applyOverride(C4);
  if (t.startsWith('chart')) return applyOverride(CHART);
  return applyOverride(TYPE_ACCENTS[t] || swatch('#4f46e5', '#eef0ff', '#312e81'));
}

// ── Semantic roles ──────────────────────────────────────────────────────────
// Meaning that is the same regardless of diagram type. A node opts in via its
// shape or its data.kind (resolved in engine.ts → roleFor()). Roles are drawn
// from one restrained palette so they stay in harmony with every type accent.
export type SemanticRole =
  | 'start' | 'stop' | 'decision' | 'error' | 'success'
  | 'external' | 'note' | 'emphasis';

const ROLE_SWATCHES: Record<SemanticRole, Swatch> = {
  start:    swatch('#16a34a', '#e9fbef', '#166534'), // green — entry point
  success:  swatch('#16a34a', '#e9fbef', '#166534'),
  stop:     swatch('#dc2626', '#fdecec', '#991b1b'), // red — terminal
  error:    swatch('#dc2626', '#fdecec', '#991b1b'),
  decision: swatch('#d97706', '#fff6e8', '#92400e'), // amber — branch
  external: swatch('#7c3aed', '#f4efff', '#5b21b6'), // violet — actor/external
  note:     swatch('#a16207', '#fef9c3', '#713f12'), // yellow paper
  emphasis: swatch('#4f46e5', '#eaecff', '#312e81'), // indigo — highlighted
};

export function roleSwatch(role: SemanticRole): Swatch {
  // Routed through applyOverride() for the same reason typeSwatch() is: a
  // palette that reskins type accents but leaves role colors at their
  // light-mode values would put a bright green `[Start]` fill on a dark
  // background. Roles lose their hue distinction under an override that sets
  // nodeStroke/nodeFill — that's the intended trade for legibility, and
  // matches what a caller asking for "high-contrast" is actually asking for.
  return applyOverride(ROLE_SWATCHES[role]);
}

// ── Chart series palette ────────────────────────────────────────────────────
// Ordered categorical palette for bar/line/pie/radar series. Colour-blind
// safe-ish, matched lightness, and drawn from the same hue vocabulary as the
// type accents so a chart sits comfortably next to a flowchart.
export const CHART_SERIES = [
  '#4f46e5', // indigo
  '#0d9488', // teal
  '#d97706', // amber
  '#db2777', // pink
  '#16a34a', // green
  '#0891b2', // cyan
  '#9333ea', // purple
  '#c2410c', // orange
  '#0369a1', // steel
  '#64748b', // slate
];

export function seriesColor(index: number): string {
  return CHART_SERIES[index % CHART_SERIES.length];
}

// ── readable text on a fill ──────────────────────────────────────────────────
const hexRgb = (hex: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) { const t = /^#([0-9a-f]{3})$/i.exec(hex.trim()); if (!t) return null; const [a, b, c] = t[1].split('').map((ch) => parseInt(ch + ch, 16)); return [a, b, c]; }
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lin = (c: number): number => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lumOf = ([r, g, b]: [number, number, number]): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
/** WCAG 2.x contrast ratio of two #rgb/#rrggbb colours (1..21), or 21 when either is unparseable. */
export function contrastOf(a: string, b: string): number {
  const ra = hexRgb(a), rb = hexRgb(b);
  if (!ra || !rb) return 21;
  const la = lumOf(ra), lb = lumOf(rb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Text colour that reads (WCAG >= 4.5) on `fill`. Keeps `preferred` when it
 *  already clears the bar; otherwise picks whichever of dark text / white has
 *  the higher contrast. `opacity` blends the fill over white first (a faded
 *  group lightens what the text actually sits on). Unparseable fills return
 *  `preferred`. */
export function readableTextOn(fill: string, preferred?: string, opacity = 1): string {
  const rgb = hexRgb(fill);
  if (!rgb) return preferred ?? DS.neutral.text;
  const eff = rgb.map((c) => Math.round(c * opacity + 255 * (1 - opacity)));
  const effHex = '#' + eff.map((c) => c.toString(16).padStart(2, '0')).join('');
  if (preferred && contrastOf(preferred, effHex) >= 4.5) return preferred;
  const dark = DS.neutral.text, light = '#ffffff', ink = '#0b1220';
  // Pure black last: only reached when dark/white/ink all miss 4.5 (e.g. #6366f1: white 4.47, black ~4.7).
  const cands = [dark, light, ink, '#000000'];
  for (const c of cands) if (contrastOf(c, effHex) >= 4.5) return c;
  return cands.reduce((b, c) => (contrastOf(c, effHex) > contrastOf(b, effHex) ? c : b));
}

/** Mix two hex colours: t=0 gives `a`, t=1 gives `b`. Used to get the effective
 *  background of a tinted chip so text on it can be checked with readableTextOn. */
export function blendHex(a: string, b: string, t: number): string {
  const ra = hexRgb(a), rb = hexRgb(b);
  if (!ra || !rb) return a;
  return '#' + ra.map((c, i) => Math.round(c * (1 - t) + rb[i] * t).toString(16).padStart(2, '0')).join('');
}

// ── helpers ─────────────────────────────────────────────────────────────────
function swatch(stroke: string, fill: string, text: string): Swatch {
  return { stroke, fill, text, accent: stroke };
}

/** Named built-in palettes, resolved by id (e.g. CLI `--theme dark`). These
 *  are lighter-weight than a full `Theme` (types/style.ts) — just the color
 *  handful the renderer actually varies per-theme — since a full Theme also
 *  carries Rough.js roughness/font settings that most callers don't want to
 *  override just to reskin colors. */
export const BUILTIN_PALETTES: Record<string, PaletteOverride> = {
  default: {},
  dark: {
    nodeStroke: '#93c5fd',
    nodeFill: '#1e293b',
    nodeText: '#e2e8f0',
    edgeStroke: '#94a3b8',
    background: '#0f172a',
    neutralText: '#e2e8f0',
    neutralMuted: '#94a3b8',
    neutralFill: '#1e293b',
    neutralSurface: '#172033',
  },
  'high-contrast': {
    nodeStroke: '#000000',
    nodeFill: '#ffffff',
    nodeText: '#000000',
    edgeStroke: '#000000',
    background: '#ffffff',
    neutralText: '#000000',
    neutralMuted: '#000000',
    neutralFill: '#ffffff',
    neutralSurface: '#ffffff',
  },
};

export function resolvePalette(idOrOverride: string | PaletteOverride | undefined): PaletteOverride | undefined {
  if (!idOrOverride) return undefined;
  if (typeof idOrOverride === 'string') return BUILTIN_PALETTES[idOrOverride];
  return idOrOverride;
}
