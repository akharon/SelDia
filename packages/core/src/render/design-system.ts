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

  /** Stroke widths (px). One set for the whole system. */
  stroke: { node: 1.75, edge: 1.75, divider: 1 },

  /** Corner radius for rectangular nodes (px). */
  radius: 7,

  /** Sketchy roughness — low, so hand-drawn reads as "crafted" not "messy". */
  roughness: 0.9,

  /** Shared neutrals used when a node has no accent/role of its own. */
  neutral: {
    text: '#1f2933',
    muted: '#5b6b7b',
    edge: '#64748b',
    fill: '#f6f8fb',
    stroke: '#94a3b8',
    surface: '#ffffff',
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
  if (t.startsWith('c4')) return C4;
  if (t.startsWith('chart')) return CHART;
  return TYPE_ACCENTS[t] || swatch('#4f46e5', '#eef0ff', '#312e81');
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
  return ROLE_SWATCHES[role];
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

// ── helpers ─────────────────────────────────────────────────────────────────
function swatch(stroke: string, fill: string, text: string): Swatch {
  return { stroke, fill, text, accent: stroke };
}
