// =============================================================================
// SelDiA — Floorplan Drag Mapping (pure, testable)
// =============================================================================
// A floorplan does not use the generic `{ x, y }` manual-override attributes:
// rooms are placed with `at: "x,y"` in metres and furniture with a
// ROOM-RELATIVE `at:` plus `in: "<Room>"` (see diagrams/floorplan.ts and
// render/custom-layout.ts `layoutFloorplan`). The generic drag write-back
// therefore wrote pixel `x`/`y` keys the floorplan plugin never reads — the
// drag looked applied, then vanished on the next compile.
//
// This module turns a drop point in laid-out pixel space back into the
// attributes the floorplan DSL actually reads, including re-parenting a piece
// of furniture into whichever room now contains it (that is what makes
// "move furniture from one room to another" work by dragging).
//
// Pure string/number math on the positioned IR, so it is unit-testable
// without an extension host.
// =============================================================================

/** The subset of a positioned IR node this mapping needs. */
export interface FpPositionedNode {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  data?: Record<string, unknown>;
}

export interface FpDragPatch {
  /** Attributes to merge into the node's declaration. */
  attrs: Record<string, string | number>;
  /** Room the furniture ended up in, when it changed. Purely informational
   *  (the caller surfaces it in a status message). */
  movedToRoom?: string;
}

const fpKind = (n: FpPositionedNode): string => String((n.data as any)?.fpKind ?? '');

/** Metres, rounded to the centimetre — floorplan coordinates are authored as
 *  short decimals and a raw float would rewrite `at: "1,2"` as
 *  `at: "1.0166666,2"` on every nudge. */
function m(px: number, scale: number): number {
  return Math.round((px / scale) * 100) / 100;
}

/** `"1.5,2"` — trailing `.0` trimmed by the rounding above. */
function point(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Map a floorplan node's dragged pixel position to DSL attributes.
 *
 * - `room`   → absolute `at:` in metres.
 * - `furniture` → room-relative `at:`, plus `in:` when the drop point lands in
 *   a different room. Furniture dropped outside every room keeps its current
 *   room and is positioned relative to it (negative offsets are legal), so a
 *   drag can never orphan a piece into an unparented state.
 * - `door` / `window` → `at: "<Room>.<edge>"` + `offset:`, snapping to the
 *   nearest wall of the room the opening is dropped on.
 *
 * Returns `undefined` for node kinds with no positional syntax (`measure`) or
 * when the diagram carries no floorplan scale.
 */
export function computeFloorplanDragPatch(
  nodes: FpPositionedNode[],
  nodeId: string,
  newX: number,
  newY: number,
  scale: number
): FpDragPatch | undefined {
  if (!scale || !Number.isFinite(scale)) return undefined;
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return undefined;
  const kind = fpKind(node);
  const rooms = nodes.filter((n) => fpKind(n) === 'room');

  if (kind === 'room') {
    // Rooms are laid out at `at * scale + pad`, then the whole drawing may be
    // shifted to make room for dimension strings. Both offsets are constant
    // across a render, so recover them from THIS room's own pixel/metre pair
    // rather than re-deriving the padding.
    const at = (node.data as any)?.fpAt as { x: number; y: number } | undefined;
    const originX = node.position.x - (at?.x ?? 0) * scale;
    const originY = node.position.y - (at?.y ?? 0) * scale;
    return { attrs: { at: point(m(newX - originX, scale), m(newY - originY, scale)) } };
  }

  if (kind === 'furniture') {
    const cx = newX + node.size.width / 2;
    const cy = newY + node.size.height / 2;
    const currentRoomId = String((node.data as any)?.roomId ?? '');
    const target = rooms.find((r) => contains(r, cx, cy))
      ?? rooms.find((r) => r.id === currentRoomId);
    if (!target) return undefined;
    const attrs: Record<string, string | number> = {
      at: point(m(newX - target.position.x, scale), m(newY - target.position.y, scale)),
    };
    if (target.id !== currentRoomId) attrs.in = target.id;
    return { attrs, movedToRoom: target.id !== currentRoomId ? target.id : undefined };
  }

  if (kind === 'door' || kind === 'window') {
    const cx = newX + node.size.width / 2;
    const cy = newY + node.size.height / 2;
    const currentRoomId = String((node.data as any)?.roomId ?? '');
    const target = rooms.find((r) => contains(r, cx, cy, scale * 0.5))
      ?? rooms.find((r) => r.id === currentRoomId);
    if (!target) return undefined;
    const wall = nearestEdge(target, cx, cy);
    // `offset` runs along the wall from the room's north-west corner, the same
    // convention layoutFloorplan reads it back with.
    const along = wall === 'north' || wall === 'south'
      ? cx - target.position.x - node.size.width / 2
      : cy - target.position.y - node.size.height / 2;
    const span = wall === 'north' || wall === 'south' ? target.size.width : target.size.height;
    const openingPx = Number((node.data as any)?.width ?? 0) * scale;
    const clamped = Math.max(0, Math.min(along, Math.max(0, span - openingPx)));
    return { attrs: { at: `${target.id}.${wall}`, offset: m(clamped, scale) } };
  }

  return undefined;
}

function contains(r: FpPositionedNode, x: number, y: number, slack = 0): boolean {
  return x >= r.position.x - slack && x <= r.position.x + r.size.width + slack
    && y >= r.position.y - slack && y <= r.position.y + r.size.height + slack;
}

function nearestEdge(r: FpPositionedNode, x: number, y: number): 'north' | 'south' | 'east' | 'west' {
  const d = {
    north: Math.abs(y - r.position.y),
    south: Math.abs(r.position.y + r.size.height - y),
    west: Math.abs(x - r.position.x),
    east: Math.abs(r.position.x + r.size.width - x),
  };
  return (Object.keys(d) as Array<keyof typeof d>).reduce((a, b) => (d[b] < d[a] ? b : a));
}
