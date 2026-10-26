// =============================================================================
// SelDiA — Work-Item Card Renderer
// =============================================================================
// A work item draws as a card: a type badge and title in the header, then one
// row per populated section. Long sections wrap; short ones sit on one line.
//
// Size and drawing come from ONE shared layout pass (`layoutCard`). The ER
// renderer already learned this the hard way — when reserved height and drawn
// height are computed separately they drift, and links anchor on a border
// below the visible card. Here it is impossible by construction: `workItemSize`
// and `renderWorkItem` call the same function.
// =============================================================================

import type { IRNode } from '../ir/types.js';
import { roughRect, seedFor } from './rough.js';
import { DS, readableTextOn, type Swatch } from './design-system.js';
import { sectionsFor, type WorkItemType } from '../workitem/schema.js';
import { escapeXml as esc } from './escape.js';

const CARD_WIDTH = 260;
const HEADER_H = 42;
const ROW_H = 18;
const PAD_X = 12;
const BOTTOM_PAD = 8;
/** Average glyph width as a fraction of font size — the same heuristic the
 *  layout's text measurer uses (layout/text-measure.ts), kept in sync so a card
 *  wraps where the measurer would say it wraps. */
const AVG_CHAR_EM = 0.56;

const charW = (fontSize: number) => fontSize * AVG_CHAR_EM;

/** How many characters fit in `px` at `fontSize`. */
const fitChars = (px: number, fontSize: number) => Math.max(8, Math.floor(px / charW(fontSize)));
/** A long section past this many wrapped lines is truncated with an ellipsis.
 *  A card is a summary; a 40-line rationale belongs in the linked document. */
const MAX_LINES = 4;

/** Short, uppercase badge per type — the type must be readable at a glance,
 *  which is the whole reason these are cards and not plain boxes. */
const BADGE: Record<WorkItemType, string> = {
  requirement: 'REQ', decision: 'ADR', test: 'TEST', capability: 'CAP',
  feature: 'FEAT', story: 'STORY', risk: 'RISK',
};

/** Per-type accent, so a wall of items reads as a structure rather than a grid.
 *  Reuses the semantic-role hues documented in design-system.ts: green = a
 *  proven/verifying thing, red = a hazard, amber = a decision point. */
const ACCENT: Record<WorkItemType, { stroke: string; fill: string; text: string }> = {
  requirement: { stroke: '#4f46e5', fill: '#eaecff', text: '#312e81' }, // indigo
  decision:    { stroke: '#d97706', fill: '#fff6e8', text: '#92400e' }, // amber
  test:        { stroke: '#16a34a', fill: '#e9fbef', text: '#166534' }, // green
  capability:  { stroke: '#0d9488', fill: '#e6fffb', text: '#115e59' }, // teal
  feature:     { stroke: '#2563eb', fill: '#e8f1ff', text: '#1e3a8a' }, // blue
  story:       { stroke: '#7c3aed', fill: '#f4efff', text: '#5b21b6' }, // violet
  risk:        { stroke: '#dc2626', fill: '#fdecec', text: '#991b1b' }, // red
};

/** Relative luminance of a #rrggbb color, used only to ask "is the surface we
 *  are painting on dark?". */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1; // unknown format: assume light, i.e. keep the light accents
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The accent to draw with, resolved against the surface the card sits on.
 *
 *  The ACCENT table above is a set of LIGHT-mode tones: a mid stroke, a very
 *  light tint for the header band, and a dark title color to read on that
 *  tint. On a dark surface all three invert their roles — the "very light"
 *  tint becomes a near-black wash of the same hue and the dark title has to
 *  become the bright one, or the card renders as light-on-light. Deriving it
 *  from the same hue keeps the per-type palette recognisable across themes
 *  instead of maintaining a second hand-written table that can drift. */
function accentFor(itemType: WorkItemType, swatch: Swatch): { stroke: string; fill: string; text: string } {
  const base = ACCENT[itemType] || { stroke: swatch.stroke, fill: swatch.fill, text: swatch.text };
  if (luminance(DS.neutral.surface) > 0.5) return base;
  return {
    stroke: base.stroke,
    // A translucent wash of the accent over the dark card body: the header
    // still reads as "this type" without becoming a bright slab.
    fill: `${base.stroke}33`,
    // The stroke tone is the mid one, which is exactly what stays legible on
    // a dark ground — the light table's `text` is far too dark there.
    text: base.stroke,
  };
}

function wrap(text: string, width: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ` ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

interface CardRow { label: string; labelW: number; lines: string[] }

/** Pixel width of a section's bold label plus its gutter. */
function labelWidth(label: string): number {
  return label.length * charW(DS.fontSize.small) + 14;
}

/** The single source of truth for a card's geometry.
 *
 *  Wrapping is done against real pixel budgets rather than one flat character
 *  count, because a long section's FIRST line starts after its label and the
 *  rest run full width. Measuring both against the same budget is what pushed
 *  text past the card's right edge and left the border short of the content. */
function layoutCard(label: string, itemType: WorkItemType, fields: Record<string, unknown>) {
  const inner = CARD_WIDTH - PAD_X * 2;
  const rows: CardRow[] = [];

  for (const spec of sectionsFor(itemType)) {
    const raw = fields[spec.key];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = String(raw);
    const labelW = labelWidth(spec.label);

    if (spec.form === 'long') {
      const firstBudget = fitChars(inner - labelW, DS.fontSize.small);
      const restBudget = fitChars(inner, DS.fontSize.small);
      const all = wrapTwoColumn(value, firstBudget, restBudget);
      const lines = all.length > MAX_LINES
        ? [...all.slice(0, MAX_LINES - 1), `${all[MAX_LINES - 1].slice(0, Math.max(1, restBudget - 1))}…`]
        : all;
      rows.push({ label: spec.label, labelW, lines });
    } else {
      // A short value shares its line with its label. When it doesn't fit, it
      // wraps like a long one rather than being truncated — a clipped
      // `Measure` or `Verification` loses exactly the content the reader came
      // for. The MAX_LINES cap still applies, so it cannot grow without bound.
      const firstBudget = fitChars(inner - labelW, DS.fontSize.small);
      const restBudget = fitChars(inner, DS.fontSize.small);
      const all = wrapTwoColumn(value, firstBudget, restBudget);
      const lines = all.length > MAX_LINES
        ? [...all.slice(0, MAX_LINES - 1), `${all[MAX_LINES - 1].slice(0, Math.max(1, restBudget - 1))}…`]
        : all;
      rows.push({ label: spec.label, labelW, lines });
    }
  }

  const titleLines = wrap(label, fitChars(inner, DS.fontSize.label)).slice(0, 2);
  const headerH = HEADER_H + (titleLines.length - 1) * ROW_H;
  const bodyH = rows.reduce((h, r) => h + ROW_H * r.lines.length, 0);
  return {
    rows, titleLines, headerH,
    width: CARD_WIDTH,
    height: headerH + (bodyH > 0 ? bodyH + BOTTOM_PAD : 0),
  };
}

/** Wrap where the first line has a narrower budget than the rest. */
function wrapTwoColumn(text: string, first: number, rest: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const budget = lines.length === 0 ? first : rest;
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= budget) cur += ` ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

export function workItemSize(label: string, itemType: WorkItemType, fields: Record<string, unknown>): { width: number; height: number } {
  const { width, height } = layoutCard(label, itemType, fields);
  return { width, height };
}

export function renderWorkItem(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const itemType = ((node.data?.itemType as WorkItemType) || 'requirement');
  const fields = (node.data?.fields as Record<string, unknown>) || {};
  const card = layoutCard(node.label, itemType, fields);

  const x = node.position.x + pad;
  const y = node.position.y + pad;
  const w = node.size.width || card.width;
  const h = card.height; // must equal workItemSize().height
  const accent = accentFor(itemType, swatch);
  const seed = seedFor(node.id);

  let el = sketchy
    ? roughRect(x, y, w, h, { stroke: accent.stroke, strokeWidth: DS.stroke.node, fill: DS.neutral.surface, roughness: DS.roughness, fillStyle: 'solid', seed })
    : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.radius}" fill="${DS.neutral.surface}" stroke="${accent.stroke}" stroke-width="${DS.stroke.node}"/>\n`;

  // Header band, rounded to match the card's own top corners.
  const r = DS.radius;
  el += `    <path d="M ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + card.headerH} H ${x} Z" fill="${accent.fill}"/>\n`;
  el += `    <line x1="${x}" y1="${y + card.headerH}" x2="${x + w}" y2="${y + card.headerH}" stroke="${accent.stroke}" stroke-width="${DS.stroke.divider}"/>\n`;

  // Type badge, then the id, on the header's first line.
  const badge = BADGE[itemType] || 'ITEM';
  const badgeW = badge.length * 8.5 + 12;
  el += `    <rect x="${x + PAD_X}" y="${y + 8}" width="${badgeW}" height="15" rx="3" fill="${accent.stroke}"/>\n`;
  el += `    <text x="${x + PAD_X + badgeW / 2}" y="${y + 19}" text-anchor="middle" fill="${readableTextOn(accent.stroke, '#ffffff')}" font-size="${DS.fontSize.meta}" font-weight="700" font-family="${DS.fontFamily}">${esc(badge)}</text>\n`;
  el += `    <text x="${x + PAD_X + badgeW + 8}" y="${y + 19.5}" text-anchor="start" fill="${DS.neutral.muted}" font-size="${DS.fontSize.small}" font-family="${DS.monoFamily}">${esc(node.id)}</text>\n`;

  // Title, wrapped to at most two lines.
  card.titleLines.forEach((line, i) => {
    el += `    <text x="${x + PAD_X}" y="${y + 36 + i * ROW_H}" text-anchor="start" font-weight="700" fill="${accent.text}" font-size="${DS.fontSize.label}" font-family="${DS.fontFamily}">${esc(line)}</text>\n`;
  });

  // Section rows: a muted label, then the value.
  let ry = y + card.headerH + 4;
  for (const row of card.rows) {
    el += `    <text x="${x + PAD_X}" y="${ry + ROW_H * 0.7}" text-anchor="start" fill="${DS.neutral.muted}" font-size="${DS.fontSize.small}" font-weight="700" font-family="${DS.fontFamily}">${esc(row.label)}</text>\n`;
    const labelW = row.labelW;
    row.lines.forEach((line, i) => {
      // A long section's first line sits beside its label and the rest run
      // full width, so a wrapped paragraph doesn't waste a whole row on a
      // three-character label.
      const tx = i === 0 ? x + PAD_X + labelW : x + PAD_X;
      el += `    <text x="${tx}" y="${ry + ROW_H * 0.7 + i * ROW_H}" text-anchor="start" fill="${DS.neutral.text}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">${esc(line)}</text>\n`;
    });
    ry += ROW_H * row.lines.length;
  }

  return el;
}
