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
import { measureLabel } from '../layout/text-measure.js';
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
const WRAP_AT = 14;

/** Break a long single-line label near its middle space into two lines. */
function wrap(label: string): string[] {
  const raw = (label || '').replace(/\\n/g, '\n').split('\n');
  if (raw.length > 1 || raw[0].length <= WRAP_AT) return raw;
  const words = raw[0].split(' ');
  if (words.length < 2) return raw;
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
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
    return besideRight(n, [bbox(n)]);
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
    const f = Math.min(DS.fontSize.label, 11);
    const lm = m(n.label, f);
    const base = r.y + r.height - 6;
    return {
      box: { x: cx - lm.width / 2, y: base - f, width: lm.width, height: lm.height },
      glyphs: [{ x: r.x, y: r.y, width: r.width, height: r.height * 0.85 }],
    };
  }
  if (String(n.shape) === 'cylinder' && !d.networkKind && !d.c4Kind) {
    const ry = 12;
    const lm = m(n.label, DS.fontSize.label);
    const cy = r.y + r.height / 2 + ry / 2;
    return {
      box: { x: cx - lm.width / 2, y: cy - lm.height / 2, width: lm.width, height: lm.height },
      glyphs: [{ x: r.x, y: r.y, width: r.width, height: ry * 2 }, { x: r.x, y: r.y + r.height - ry * 2, width: r.width, height: ry * 2 }],
    };
  }
  return undefined;
}

/** C4 database cylinder: end-cap radius and the first label baseline, chosen so
 *  the label starts below the top ellipse and the description clears the bottom one. */
export const C4_DB_RY = 8;
export const C4_DB_LABEL_Y = 34;
