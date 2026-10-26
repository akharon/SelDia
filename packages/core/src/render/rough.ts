// =============================================================================
// SelDiA — Rough.js-backed shape rendering
// =============================================================================
// Replaces the generic feTurbulence/feDisplacementMap filter (which can only
// wobble the outline of an already-perfect vector shape) with real Rough.js
// generator output: hachure/cross-hatch fills, multi-stroke doubled outlines,
// per-shape-seeded wobble. RoughGenerator is headless (no DOM/canvas
// required), so it works inside the pure SVG-string renderer.
// See docs/improvement_request.md item 4.
// =============================================================================

import rough from 'roughjs';
import { DS } from './design-system.js';
import type { RoughGenerator } from 'roughjs/bin/generator.js';
import type { Options as RoughOptions } from 'roughjs/bin/core.js';

let generator: RoughGenerator | undefined;
function gen(): RoughGenerator {
  if (!generator) generator = rough.generator();
  return generator;
}

export interface RoughStyle {
  stroke: string;
  strokeWidth: number;
  fill: string;
  roughness?: number;
  bowing?: number;
  fillStyle?: string;
  hachureAngle?: number;
  hachureGap?: number;
  seed?: number;
  disableMultiStroke?: boolean;
}

function toRoughOptions(s: RoughStyle): RoughOptions {
  return {
    stroke: s.stroke,
    strokeWidth: s.strokeWidth,
    fill: s.fill,
    fillStyle: s.fillStyle || 'hachure',
    roughness: s.roughness ?? DS.roughness,
    bowing: s.bowing ?? 1,
    hachureAngle: s.hachureAngle ?? -41,
    hachureGap: s.hachureGap,
    seed: s.seed,
    disableMultiStroke: s.disableMultiStroke,
  };
}

/** Render a drawable's op-sets to `<path>` elements (fill layer(s) first,
 *  then stroke layer) — this is what gives hachure fills their visible
 *  individual pen strokes and doubled/overlapping outlines, unlike a single
 *  flat-fill `<rect>`/`<polygon>`. */
function drawableToSvg(drawable: ReturnType<RoughGenerator['rectangle']>): string {
  const g = gen();
  let out = '';
  for (const info of g.toPaths(drawable)) {
    const fillAttr = info.fill ? ` fill="${info.fill}"` : ' fill="none"';
    const strokeAttr = info.stroke && info.stroke !== 'none' ? ` stroke="${info.stroke}" stroke-width="${Math.round(info.strokeWidth * 100) / 100}"` : '';
    out += `    <path d="${info.d}"${fillAttr}${strokeAttr}/>\n`;
  }
  return out;
}

export function roughRect(x: number, y: number, w: number, h: number, style: RoughStyle): string {
  return drawableToSvg(gen().rectangle(x, y, w, h, toRoughOptions(style)));
}

export function roughEllipse(cx: number, cy: number, w: number, h: number, style: RoughStyle): string {
  return drawableToSvg(gen().ellipse(cx, cy, w, h, toRoughOptions(style)));
}

export function roughPolygon(points: [number, number][], style: RoughStyle): string {
  return drawableToSvg(gen().polygon(points, toRoughOptions(style)));
}

export function roughLine(x1: number, y1: number, x2: number, y2: number, style: Omit<RoughStyle, 'fill'>): string {
  return drawableToSvg(gen().line(x1, y1, x2, y2, toRoughOptions({ bowing: 0, disableMultiStroke: true, ...style, fill: 'none' })));
}

/** Deterministic per-node seed so repeated renders of the same diagram are
 *  stable (same wobble every time) but different nodes don't look
 *  mechanically identical — addresses the "uniform/flat" complaint in
 *  item 4 even independent of switching to real Rough.js. */
export function seedFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 2147483647 || 1;
}
