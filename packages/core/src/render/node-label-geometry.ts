// =============================================================================
// SelDiA — Node label geometry for icon shapes
// =============================================================================
// Icon-style nodes (network devices, BPMN events/gateways, C4 databases) draw a
// glyph that fills the node box, so the label can't sit on it. This module is
// the single source of truth for where those labels go AND how big their boxes
// are, shared by the renderer (to draw) and the layout metrics (to measure
// `nodeLabelHits`), so the two can never drift apart.

import type { IRNode } from '../ir/types.js';
import type { Rect } from '../types/common.js';
import { measureLabel, textWidth, sizeForLabel } from '../layout/text-measure.js';
import { DS } from './design-system.js';

export interface NodeLabelLayout {
  /** Label text, wrapped to `\n`-separated lines. */
  text: string;
  anchor: 'start' | 'middle' | 'end';
  /** Anchor x and first-line baseline y (diagram space, before `off`). */
  x: number;
  y: number;
  lineHeight: number;
  fontSize: number;
  /** Bounding box of the drawn label text. */
  box: Rect;
  /** Glyph art the label must stay off. */
  glyphs: Rect[];
}

const GAP = 8;
/** Icon-label wrap width (px) before a long label is broken onto a second line. */
const WRAP_W = 96;

/** Balanced wrapping: break `text` into the fewest lines that fit `maxWidth`,
 *  placing the breaks so the LONGEST line is as short as possible (ties go to
 *  the most even lines, so there is no ragged last word). Existing newlines
 *  (`\n` or a real line break) are kept; each paragraph is wrapped alone. A
 *  single word wider than `maxWidth` keeps its own line. */
export function balancedWrap(text: string, maxWidth: number, fontSize: number): string[] {
  const out: string[] = [];
  for (const para of (text || '').replace(/\\n/g, '\n').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length < 2 || textWidth(para, fontSize) <= maxWidth) { out.push(para); continue; }
    const space = textWidth(' ', fontSize);
    const ww = words.map((w) => textWidth(w, fontSize));
    const n = words.length;
    const span = (i: number, j: number): number => { // words i..j-1 on one line
      let w = space * (j - i - 1);
      for (let k = i; k < j; k++) w += ww[k];
      return w;
    };
    // Fewest lines under maxWidth (greedy is optimal for the line count).
    let lines = 1, cur = ww[0];
    for (let k = 1; k < n; k++) {
      if (cur + space + ww[k] <= maxWidth) cur += space + ww[k];
      else { lines++; cur = ww[k]; }
    }
    // DP: split into exactly `lines` lines minimising (longest, sum of squares).
    type Cell = { max: number; sq: number; prev: number };
    const dp: Cell[][] = Array.from({ length: lines + 1 }, () => Array<Cell>(n + 1).fill({ max: Infinity, sq: Infinity, prev: -1 }));
    dp[0][0] = { max: 0, sq: 0, prev: -1 };
    for (let l = 1; l <= lines; l++) {
      for (let j = l; j <= n; j++) {
        for (let i = l - 1; i < j; i++) {
          const p = dp[l - 1][i];
          if (p.max === Infinity) continue;
          const w = span(i, j);
          const max = Math.max(p.max, w), sq = p.sq + w * w;
          const c = dp[l][j];
          if (max < c.max - 1e-9 || (Math.abs(max - c.max) <= 1e-9 && sq < c.sq)) dp[l][j] = { max, sq, prev: i };
        }
      }
    }
    const cuts: number[] = [];
    for (let l = lines, j = n; l > 0; l--) { cuts.unshift(j); j = dp[l][j].prev; }
    let from = 0;
    for (const to of cuts) { out.push(words.slice(from, to).join(' ')); from = to; }
  }
  return out;
}

/** End-cap radius of the generic cylinder. */
export const CYL_RY = 12;

/** Fraction of the node box (w, h) that is usable text area, per shape. */
const TEXT_FRAC: Record<string, [number, number]> = {
  diamond: [0.5, 0.5], hexagon: [0.8, 0.6], circle: [1 / Math.SQRT2, 1 / Math.SQRT2], cylinder: [1, 1],
};
const up4 = (v: number): number => Math.ceil(v / 4 - 1e-9) * 4;

/** Size a node so its (wrapped) label fits the shape's inscribed text box with
 *  padding. Rectangles get the legacy size. For non-rect shapes: try 1, then 2,
 *  then 3 balanced lines and take the first whose width stays <= 200px; the
 *  aspect is capped at 2:1; all sizes are rounded up to 4px steps. Deterministic. */
export function sizeForShape(label: string, shape: string, fs: number, minW: number, minH: number): { width: number; height: number } {
  const base = sizeForLabel(label, fs, minW, minH);
  const frac = TEXT_FRAC[shape];
  if (!frac) return base;
  const lh = Math.round(fs * 1.35);
  const padX = 10, padY = 6;
  const fits = (n: number): { w: number; h: number; text: number } => {
    // smallest wrap width giving <= n lines
    const full = Math.max(...label.split('\n').map((l) => textWidth(l, fs)), 1);
    let lo = 0, hi = full;
    const count = (mw: number) => balancedWrap(label, mw, fs).length;
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (count(mid) <= n) hi = mid; else lo = mid; }
    const lines = balancedWrap(label, hi + 0.5, fs);
    const tw = Math.max(...lines.map((l) => textWidth(l, fs)));
    const th = lines.length * lh;
    let w = (tw + padX * 2) / frac[0], h = (th + padY * 2) / frac[1];
    if (shape === 'cylinder') { w = tw + padX * 2; h = th + padY * 2 + CYL_RY * 4; }
    w = Math.max(w, minW); h = Math.max(h, minH);
    if (shape !== 'cylinder') { if (w > 2 * h) h = w / 2; else if (h > 2 * w) w = h / 2; }
    return { w: up4(w), h: up4(h), text: tw };
  };
  let pick = fits(1);
  for (const n of [2, 3]) { if (pick.w <= 200) break; pick = fits(n); }
  return { width: pick.w, height: pick.h };
}

/** The rectangle a node's label may occupy so it stays inside the drawn outline
 *  (for wrapping and fit checks). Rectangles get the full box; other shapes the
 *  largest axis-aligned rect inscribed in the outline the engine draws. */
export function shapeTextBox(n: IRNode): Rect {
  const r = bbox(n);
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const centred = (w: number, h: number, dy = 0): Rect => ({ x: cx - w / 2, y: cy + dy - h / 2, width: w, height: h });
  switch (String(n.shape)) {
    case 'cylinder': { // body between the end caps (cap ry = 12)
      return { x: r.x, y: r.y + CYL_RY * 2, width: r.width, height: Math.max(0, r.height - CYL_RY * 4) };
    }
    case 'diamond': return centred(r.width / 2, r.height / 2);
    case 'hexagon': return centred(r.width * 0.8, r.height * 0.6); // pointy-top hexagon, vertical sides at 25-75% of h
    case 'circle': return centred(r.width / Math.SQRT2, r.height / Math.SQRT2); // ellipse
    case 'parallelogram': return centred(Math.max(0, r.width - 30), r.height);
    case 'stadium': return centred(Math.max(0, r.width - r.height), r.height);
    default: return r;
  }
}

/** Break a long single-line label into balanced lines. */
function wrap(label: string): string[] {
  return balancedWrap(label, WRAP_W, DS.fontSize.small);
}

const bbox = (n: IRNode): Rect => ({ x: n.position.x, y: n.position.y, width: n.size.width, height: n.size.height });

function besideRight(n: IRNode, glyphs: Rect[]): NodeLabelLayout {
  const fs = DS.fontSize.small;
  const lines = wrap(n.label);
  const m = measureLabel(lines.join('\n'), fs);
  const lh = Math.round(fs * 1.3);
  const cy = n.position.y + n.size.height / 2;
  const x = n.position.x + n.size.width + GAP;
  const top = cy - (lines.length * lh) / 2;
  return {
    text: lines.join('\n'), anchor: 'start', x, y: top + lh * 0.8, lineHeight: lh, fontSize: fs,
    box: { x, y: top, width: m.width, height: lines.length * lh }, glyphs,
  };
}

function belowCentre(n: IRNode, glyphs: Rect[]): NodeLabelLayout {
  const fs = DS.fontSize.small;
  const lines = wrap(n.label);
  const m = measureLabel(lines.join('\n'), fs);
  const lh = Math.round(fs * 1.3);
  const cx = n.position.x + n.size.width / 2;
  const top = n.position.y + n.size.height + 4;
  return {
    text: lines.join('\n'), anchor: 'middle', x: cx, y: top + lh * 0.8, lineHeight: lh, fontSize: fs,
    box: { x: cx - m.width / 2, y: top, width: m.width, height: lines.length * lh }, glyphs,
  };
}

function aboveLeft(n: IRNode, glyphs: Rect[]): NodeLabelLayout {
  const fs = DS.fontSize.small;
  const lines = wrap(n.label);
  const m = measureLabel(lines.join('\n'), fs);
  const lh = Math.round(fs * 1.3);
  const right = n.position.x + n.size.width / 2 - 6;
  const bottom = n.position.y - 4;
  const top = bottom - lines.length * lh;
  return {
    text: lines.join('\n'), anchor: 'end', x: right, y: top + lh * 0.8, lineHeight: lh, fontSize: fs,
    box: { x: right - m.width, y: top, width: m.width, height: lines.length * lh }, glyphs,
  };
}

/** Label placement for icon nodes, or undefined for ordinary nodes (whose
 *  label is centred inside the box and handled by the generic renderer). */
export function iconLabelLayout(n: IRNode): NodeLabelLayout | undefined {
  const d = (n.data ?? {}) as Record<string, unknown>;
  const nk = d.networkKind as string | undefined;
  if (nk) {
    if (nk === 'switch') return undefined; // label sits in the box, clear of the port strip
    return belowCentre(n, [bbox(n)]);
  }
  const bk = d.bpmnKind as string | undefined;
  if (bk === 'startEvent' || bk === 'endEvent' || bk === 'intermediateEvent') return besideRight(n, [bbox(n)]);
  if (bk === 'gateway') return aboveLeft(n, [bbox(n)]);
  return undefined;
}

/** Metrics-only model of labels the renderer keeps inside a node whose glyph
 *  art still competes for the same pixels (C4 database, plain cylinder, actor,
 *  network switch). Returns the label box and the art it must not touch. */
export function innerLabelModel(n: IRNode): { box: Rect; glyphs: Rect[] } | undefined {
  const d = (n.data ?? {}) as Record<string, unknown>;
  const r = bbox(n);
  const cx = r.x + r.width / 2;
  const fs = DS.fontSize.label;
  const m = (t: string, f: number) => measureLabel(t, f);
  if (d.c4Kind === 'containerDb') {
    const ry = C4_DB_RY;
    const lm = m(n.label, fs);
    const top = r.y + C4_DB_LABEL_Y - fs;
    return {
      box: { x: cx - lm.width / 2, y: top, width: lm.width, height: lm.height },
      glyphs: [{ x: r.x, y: r.y, width: r.width, height: ry * 2 }, { x: r.x, y: r.y + r.height - ry * 2, width: r.width, height: ry * 2 }],
    };
  }
  if (d.networkKind === 'switch') {
    const lm = m(n.label, DS.fontSize.meta);
    const base = r.y + r.height / 2 - 6;
    return {
      box: { x: cx - lm.width / 2, y: base - DS.fontSize.meta, width: lm.width, height: lm.height },
      glyphs: [{ x: r.x, y: r.y + r.height - 12, width: r.width, height: 8 }],
    };
  }
  if (String(n.shape) === 'actor') {
    // C4 person: label baseline h-12 under a body ending at h-28.
    // Use-case actor: label baseline h-4 under legs ending at h-20.
    const c4 = d.c4Kind === 'person';
    const f = c4 ? DS.fontSize.label : Math.min(DS.fontSize.small, 11);
    const lm = m(n.label, f);
    const base = r.y + r.height - (c4 ? 12 : 4);
    return {
      box: { x: cx - lm.width / 2, y: base - f, width: lm.width, height: lm.height },
      glyphs: [{ x: r.x, y: r.y, width: r.width, height: r.height - (c4 ? 28 : 20) }],
    };
  }
  if (String(n.shape) === 'cylinder' && !d.networkKind && !d.c4Kind) {
    const ry = CYL_RY;
    const lm = m(n.label, DS.fontSize.label);
    const cy = r.y + r.height / 2;
    return {
      box: { x: cx - lm.width / 2, y: cy - lm.height / 2, width: lm.width, height: lm.height },
      glyphs: [{ x: r.x, y: r.y, width: r.width, height: ry * 2 }, { x: r.x, y: r.y + r.height - ry * 2, width: r.width, height: ry * 2 }],
    };
  }
  return undefined;
}

/** C4 database cylinder: end-cap radius and the first label baseline, chosen so
 *  the label starts below the top ellipse and the description clears the bottom one. */
/** C4 box width, horizontal label padding and label line height (sizing and drawing share these). */
export const C4_BOX_W = 180, C4_LABEL_PAD = 24, C4_LABEL_LH = 18;
export const C4_DB_RY = 8;
export const C4_DB_LABEL_Y = 34;
