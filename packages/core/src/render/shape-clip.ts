// =============================================================================
// SelDiA — Shape-aware endpoint clipping
// =============================================================================
// Edges used to be clipped to a node's bounding RECT, which leaves arrows
// detached from diamonds, ellipses and hexagons (they stop at the box corner,
// well short of the visible outline). Here each shape gets an inside-test that
// matches how the renderer draws it, inflated by `gap`; the clip point is found
// by bisection along the route segment. Pure geometry, engine-independent.

import type { IRNode } from '../ir/types.js';
import type { Point, Rect } from '../types/common.js';

type Inside = (p: Point) => boolean;

const rectOf = (n: IRNode): Rect => ({ x: n.position.x, y: n.position.y, width: n.size.width, height: n.size.height });

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Polygon scaled about the node centre so its outline sits `gap` further out
 *  along both axes (exact for axis-aligned sides, close for slanted ones). */
function inflatePolygon(poly: Point[], r: Rect, gap: number): Point[] {
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const sx = (r.width / 2 + gap) / (r.width / 2 || 1), sy = (r.height / 2 + gap) / (r.height / 2 || 1);
  return poly.map((q) => ({ x: cx + (q.x - cx) * sx, y: cy + (q.y - cy) * sy }));
}

/** Inside-test for the node's drawn outline grown by `gap`. */
export function shapeInside(n: IRNode, gap: number): Inside {
  const r = rectOf(n);
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const hw = r.width / 2 + gap, hh = r.height / 2 + gap;
  const box: Inside = (p) => p.x >= r.x - gap && p.x <= r.x + r.width + gap && p.y >= r.y - gap && p.y <= r.y + r.height + gap;
  switch (String(n.shape)) {
    case 'diamond':
      return (p) => Math.abs(p.x - cx) / hw + Math.abs(p.y - cy) / hh <= 1;
    case 'circle':
      return (p) => ((p.x - cx) / hw) ** 2 + ((p.y - cy) / hh) ** 2 <= 1;
    case 'hexagon': {
      const poly = inflatePolygon([
        { x: cx, y: r.y }, { x: r.x + r.width, y: r.y + r.height * 0.25 }, { x: r.x + r.width, y: r.y + r.height * 0.75 },
        { x: cx, y: r.y + r.height }, { x: r.x, y: r.y + r.height * 0.75 }, { x: r.x, y: r.y + r.height * 0.25 },
      ], r, gap);
      return (p) => pointInPolygon(p, poly);
    }
    case 'parallelogram': {
      const poly = inflatePolygon([
        { x: r.x + 15, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width - 15, y: r.y + r.height }, { x: r.x, y: r.y + r.height },
      ], r, gap);
      return (p) => pointInPolygon(p, poly);
    }
    case 'stadium': {
      const rad = r.height / 2 + gap;
      const x0 = r.x + r.height / 2, x1 = r.x + r.width - r.height / 2;
      return (p) => {
        const qx = Math.min(Math.max(p.x, x0), Math.max(x0, x1));
        return Math.hypot(p.x - qx, p.y - cy) <= rad;
      };
    }
    default:
      // rectangle, rounded-rectangle, cylinder, actor (figure bbox), note,
      // queue, cloud, subroutine, none, custom: the box is the outline.
      return box;
  }
}

/** True when the node's outline is its plain bounding box. */
export function isBoxShape(n: IRNode): boolean {
  return !['diamond', 'circle', 'hexagon', 'parallelogram', 'stadium'].includes(String(n.shape));
}

/** Where the ray from `point` (inside the node) towards `towards` leaves the
 *  node's outline grown by `gap`. If `point` is not inside, it is returned
 *  unchanged. */
export function clipToShape(node: IRNode, point: Point, towards: Point, gap = 3): Point {
  const inside = shapeInside(node, gap);
  if (!inside(point)) return point;
  let dx = towards.x - point.x, dy = towards.y - point.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return point;
  dx /= len; dy /= len;
  const far = node.size.width + node.size.height + 2 * gap + 1;
  let lo = 0, hi = far; // lo inside, hi outside along the ray
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inside({ x: point.x + dx * mid, y: point.y + dy * mid })) lo = mid; else hi = mid;
  }
  return { x: point.x + dx * hi, y: point.y + dy * hi };
}

/** Drop the leading points inside the node's (gap-grown) outline and land the
 *  polyline on it. Unchanged if it starts outside or never leaves. */
export function clipStartToShape(pts: Point[], node: IRNode, gap = 3): Point[] {
  const inside = shapeInside(node, gap);
  let i = 0;
  while (i < pts.length && inside(pts[i])) i++;
  if (i === 0 && pts.length >= 2) return attachStart(pts, node, inside);
  if (i >= pts.length) return pts;
  return [clipToShape(node, pts[i - 1], pts[i], gap), ...pts.slice(i)];
}

/** A route that starts in the node's bounding box but outside its outline (a
 *  fan anchor on a diamond's box side, say) would float detached. Extend the
 *  first segment backwards, along its own direction, until it meets the outline. */
function attachStart(pts: Point[], node: IRNode, inside: Inside): Point[] {
  const a = pts[0], b = pts[1];
  const len = Math.hypot(a.x - b.x, a.y - b.y);
  if (len < 1e-9) return pts;
  const g = 3;
  const r = rectOf(node);
  // Only a start inside the bounding box (but outside the outline) is a fan anchor to re-attach.
  if (a.x < r.x - g || a.x > r.x + r.width + g || a.y < r.y - g || a.y > r.y + r.height + g) return pts;
  const ux = (a.x - b.x) / len, uy = (a.y - b.y) / len;
  const reach = Math.max(node.size.width, node.size.height);
  let prev = 0;
  for (let t = 1; t <= reach; t++) {
    if (inside({ x: a.x + ux * t, y: a.y + uy * t })) {
      let lo = prev, hi = t;
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2;
        if (inside({ x: a.x + ux * mid, y: a.y + uy * mid })) hi = mid; else lo = mid;
      }
      return [{ x: a.x + ux * hi, y: a.y + uy * hi }, ...pts.slice(1)];
    }
    prev = t;
  }
  return pts;
}

export function clipEndToShape(pts: Point[], node: IRNode, gap = 3): Point[] {
  return clipStartToShape([...pts].reverse(), node, gap).reverse();
}
