// =============================================================================
// SelDiA — Floorplan Diagram Plugin
// =============================================================================
// A 2D architectural floor plan: rooms placed at explicit coordinates, walls
// derived implicitly from room adjacency (no wall syntax to author), doors and
// windows cut into a room's wall, and furniture/fixtures dropped in from a
// closed catalog (floorplan/catalog.ts) with an optional size override.
//
// The DSL keeps `room`/`door`/`window`/`furniture` as ordinary node
// declarations — `room Kitchen "Kitchen" { at: "0,0", size: "4x3" }` — so the
// existing generic parser (attribute-block node decls) needs no grammar
// changes. The `type:` field (mirroring workitem.ts's `itemTypeOf`) tells this
// plugin which of the four floorplan statement kinds a node is.
//
// Coordinates are plain author-given numbers (metres, by convention) — there
// is no dagre/graph layout here. See render/custom-layout.ts's layoutFloorplan
// for how positions become pixels and walls get derived from room adjacency.
// =============================================================================

import type { DiagramPlugin, PluginDiagnostic } from '../plugin/types.js';
import type { DiagramAST, ASTNodeDecl } from '../ast/nodes.js';
import type { DiagramIR, IRNode } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import { DiagramType } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';
import { catalogItem, DEFAULT_DOOR_WIDTH, DEFAULT_WINDOW_WIDTH } from '../floorplan/catalog.js';
import { renderFloorplanNode } from '../render/floorplan-render.js';

export type FloorplanStmtType = 'room' | 'door' | 'window' | 'furniture' | 'sheet' | 'measure';

const STMT_KEYWORDS: Record<string, FloorplanStmtType> = {
  room: 'room', r: 'room',
  door: 'door', d: 'door',
  window: 'window', win: 'window', w: 'window',
  furniture: 'furniture', item: 'furniture', fixture: 'furniture',
  sheet: 'sheet', titleblock: 'sheet',
  measure: 'measure', dim: 'measure', dimension: 'measure', ruler: 'measure',
};

/** A `measure` endpoint: either a bare entity id (`Sofa`) or a room wall
 *  (`Living.north`) — the same `Room.edge` spelling doors and windows use, so
 *  wall-to-object and wall-to-wall measurements need no extra syntax. */
export interface MeasureRef { id: string; edge?: 'north' | 'south' | 'east' | 'west' }

/** `"4x3"` / `"4 x 3"` → { width: 4, height: 3 }. */
function parseSize(raw: unknown): { width: number; height: number } | undefined {
  const s = String(raw ?? '').trim();
  const m = /^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/i.exec(s);
  if (!m) return undefined;
  return { width: parseFloat(m[1]), height: parseFloat(m[2]) };
}

/** `"0,0"` / `"0, 0"` → { x: 0, y: 0 }. */
function parsePoint(raw: unknown): { x: number; y: number } | undefined {
  const s = String(raw ?? '').trim();
  const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(s);
  if (!m) return undefined;
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
}

/** `Kitchen.east` → { room: "Kitchen", edge: "east" }. Also accepts a bare
 *  room id with no edge (used by `furniture ... in Room`), returning
 *  `edge: undefined`. */
function parseRoomRef(raw: unknown): { room: string; edge?: 'north' | 'south' | 'east' | 'west' } {
  const s = String(raw ?? '').trim();
  const [room, edge] = s.split('.');
  const e = edge?.toLowerCase();
  const valid = e === 'north' || e === 'south' || e === 'east' || e === 'west';
  return { room, edge: valid ? (e as 'north' | 'south' | 'east' | 'west') : undefined };
}

/** `rotation: 90` / `facing: "north"` → degrees clockwise (0/90/180/270).
 *  `facing` is sugar over `rotation` for the wall-backing items: it names the
 *  direction the item's FRONT (the open, user-facing side) points, which is
 *  the intuitive way to describe "toilet facing south" — `rotation` is the
 *  raw clockwise turn instead, for anyone who'd rather just say "rotate 90".
 *  Both read the same way a plain 0° symbol is drawn (back at the top). */
function parseRotation(attrs: Record<string, unknown>): number | undefined {
  if (attrs.rotation !== undefined) {
    const n = Number(attrs.rotation);
    if (Number.isFinite(n)) return ((Math.round(n / 90) * 90) % 360 + 360) % 360;
  }
  if (attrs.facing !== undefined) {
    const f = String(attrs.facing).toLowerCase().trim();
    const FACING_TO_ROTATION: Record<string, number> = { north: 0, east: 90, south: 180, west: 270 };
    if (f in FACING_TO_ROTATION) return FACING_TO_ROTATION[f];
  }
  return undefined;
}

/** Default rotation for a `backsToWall` item (sink, bed, sofa, toilet, …)
 *  placed touching a room wall: back the item onto whichever wall its `at`
 *  point sits closest to, so a bed's headboard (or a sofa's back, or a
 *  sink/toilet's supply side) lands against the wall instead of stranded
 *  mid-room facing it — the "foot of a bed cannot face the wall" rule.
 *  Only fires when the item is within snapping distance of an edge; further
 *  from every wall there is no wall to back onto, so it keeps rotation 0
 *  (the same "no default" behaviour as an item without `backsToWall`). */
function defaultWallRotation(
  at: { x: number; y: number },
  size: { width: number; height: number },
  room: { width: number; height: number }
): number | undefined {
  const SNAP = 0.3; // metres — "touching" the wall for auto-facing purposes
  const distances: Array<[number, 'north' | 'south' | 'east' | 'west']> = [
    [at.y, 'north'],
    [room.height - (at.y + size.height), 'south'],
    [at.x, 'west'],
    [room.width - (at.x + size.width), 'east'],
  ];
  const [dist, edge] = distances.reduce((a, b) => (b[0] < a[0] ? b : a));
  if (dist > SNAP) return undefined;
  // The symbol at rotation 0 is drawn with its back at the TOP (north) — see
  // renderFurnitureSymbol's bed/sofa/toilet/sink cases. Backing onto a given
  // wall means rotating that "top" to face that wall.
  return { north: 0, east: 90, south: 180, west: 270 }[edge];
}

function stmtTypeOf(nd: ASTNodeDecl): FloorplanStmtType | undefined {
  const attrs = (nd.style || {}) as Record<string, unknown>;
  const declared = String(attrs.type ?? '').toLowerCase();
  if (STMT_KEYWORDS[declared]) return STMT_KEYWORDS[declared];
  const cls = (nd.classList || []).map((c) => c.toLowerCase()).find((c) => STMT_KEYWORDS[c]);
  return cls ? STMT_KEYWORDS[cls] : undefined;
}

export const floorplanPlugin: DiagramPlugin = {
  id: 'seldia-floorplan',
  name: 'Floorplan Diagram',
  version: '1.0.0',
  diagramType: DiagramType.FLOORPLAN,
  description: '2D architectural floor plans with implicit walls, openings and a furniture catalog',

  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = [];

    // Room sizes, gathered up front (a separate pass so furniture can look up
    // its room's size regardless of authoring order in the DSL) — needed by
    // defaultWallRotation() to tell which edge an `at:` point is closest to.
    const roomSizes = new Map<string, { width: number; height: number }>();
    for (const stmt of ast.body) {
      if (stmt.kind !== 'NodeDecl') continue;
      const nd = stmt as ASTNodeDecl;
      if (stmtTypeOf(nd) !== 'room') continue;
      const attrs = (nd.style || {}) as Record<string, unknown>;
      const size = parseSize(attrs.size) || { width: 3, height: 3 };
      roomSizes.set(nd.id, size);
    }

    // Title-block fields: `sheet { scale: "1:100", author: "...", date: "..." }`
    // is a one-off statement, not a room/door/etc — its attrs are read once,
    // below, rather than pushed onto `nodes`. ast.metadata is always `{}` at
    // parse time (this DSL has no `key: value` diagram-header syntax), so the
    // sheet block is the only way to carry this beyond the title string.
    const titleBlock: { title?: string; scale?: string; author?: string; date?: string } = { title: ast.title };
    // Sheet-level drawing options. Automatic exterior dimensioning is on by
    // default — a floor plan without measurements is a sketch, not a plan.
    const sheetOpts: { autoDimensions: boolean } = { autoDimensions: true };

    for (const stmt of ast.body) {
      if (stmt.kind !== 'NodeDecl') continue;
      const nd = stmt as ASTNodeDecl;
      const kind = stmtTypeOf(nd);
      const attrs = (nd.style || {}) as Record<string, unknown>;

      if (kind === 'sheet') {
        if (attrs.scale) titleBlock.scale = String(attrs.scale);
        if (attrs.author) titleBlock.author = String(attrs.author);
        if (attrs.date) titleBlock.date = String(attrs.date);
        // `dimensions: "off"` suppresses the automatic exterior wall strings
        // for authors who only want their own explicit `measure` annotations.
        if (attrs.dimensions !== undefined) {
          const v = String(attrs.dimensions).toLowerCase();
          sheetOpts.autoDimensions = !(v === 'off' || v === 'false' || v === 'none' || v === 'no');
        }
        continue;
      }

      if (kind === 'room') {
        const at = parsePoint(attrs.at) || { x: 0, y: 0 };
        const size = parseSize(attrs.size) || { width: 3, height: 3 };
        nodes.push({
          id: nd.id,
          label: nd.label || nd.id,
          shape: ShapeType.RECTANGLE,
          position: { x: at.x, y: at.y }, // metres; layoutFloorplan converts to px
          size: { width: size.width, height: size.height },
          style: {},
          ports: [],
          classList: nd.classList || [],
          collapsed: false,
          data: { fpKind: 'room' },
        });
      } else if (kind === 'door' || kind === 'window') {
        const ref = parseRoomRef(attrs.at ?? attrs.on ?? nd.label);
        const offset = Number(attrs.offset ?? 0) || 0;
        const width = Number(attrs.width) || (kind === 'door' ? DEFAULT_DOOR_WIDTH : DEFAULT_WINDOW_WIDTH);
        nodes.push({
          id: nd.id,
          label: nd.label || kind,
          shape: ShapeType.NONE,
          position: { x: 0, y: 0 }, // resolved against the room's wall by layoutFloorplan
          size: { width, height: 0.2 },
          style: {},
          ports: [],
          classList: nd.classList || [],
          collapsed: false,
          data: { fpKind: kind, roomId: ref.room, edge: ref.edge, offset, width, swing: attrs.swing ? String(attrs.swing) : undefined },
        });
      } else if (kind === 'measure') {
        // `measure m1 { from: "Sofa", to: "Living.north" }` — endpoints stay
        // symbolic here; layoutFloorplan resolves them to boxes and computes
        // the clear gap, because only layout knows the pixel geometry.
        const from = parseRoomRef(attrs.from);
        const to = parseRoomRef(attrs.to);
        nodes.push({
          id: nd.id,
          label: nd.label === nd.id ? '' : (nd.label || ''),
          shape: ShapeType.NONE,
          position: { x: 0, y: 0 },
          size: { width: 0, height: 0 },
          style: {},
          ports: [],
          classList: nd.classList || [],
          collapsed: false,
          data: {
            fpKind: 'measure',
            from: { id: from.room, edge: from.edge },
            to: { id: to.room, edge: to.edge },
            // An explicit label overrides the computed length — for a
            // "min. 90" clearance note rather than the as-drawn figure.
            labelOverride: attrs.label ? String(attrs.label) : undefined,
          },
        });
      } else if (kind === 'furniture') {
        const roomRef = String(attrs.in ?? '').trim();
        const at = parsePoint(attrs.at) || { x: 0, y: 0 };
        const spec = catalogItem(String(attrs.item ?? nd.label ?? ''));
        const sizeOverride = parseSize(attrs.size);
        const size = { width: sizeOverride?.width ?? spec.width, height: sizeOverride?.height ?? spec.depth };
        // Rotation: an explicit `rotation:`/`facing:` always wins and is kept
        // as authored — that is the "locked unless explicitly turned" rule.
        // Otherwise, wall-backing items (bed, sofa, toilet, sink, …) default
        // to backing onto whichever wall they're placed against, so e.g. a
        // bed's foot never defaults to facing the wall it's pushed up to.
        let rotation = parseRotation(attrs);
        if (rotation === undefined && spec.backsToWall) {
          const room = roomSizes.get(roomRef);
          if (room) rotation = defaultWallRotation(at, size, room);
        }
        nodes.push({
          id: nd.id,
          label: spec.label,
          shape: ShapeType.RECTANGLE,
          position: { x: 0, y: 0 }, // room-relative `at`, resolved by layoutFloorplan
          size,
          style: {},
          ports: [],
          classList: nd.classList || [],
          collapsed: false,
          data: { fpKind: 'furniture', roomId: roomRef, at, symbol: spec.symbol, catalogKey: spec.key, rotation: rotation ?? 0 },
        });
      }
      // Any node decl without a recognised `type:` is silently skipped rather
      // than erroring — validate() below is where the complaint belongs.
    }

    return {
      id: 'floorplan-1',
      type: DiagramType.FLOORPLAN,
      title: ast.title || 'Floor Plan',
      nodes, edges: [], groups: [], layers: [],
      metadata: {
        titleBlock: { ...titleBlock, title: titleBlock.title || 'Floor Plan' },
        floorplanOptions: sheetOpts,
      },
    };
  },

  validate(ast: DiagramAST): PluginDiagnostic[] {
    const out: PluginDiagnostic[] = [];
    const roomIds = new Set<string>();
    // A `measure` endpoint may name any drawn entity, not just a room.
    const allIds = new Set<string>();
    for (const stmt of ast.body) {
      if (stmt.kind !== 'NodeDecl') continue;
      const nd = stmt as ASTNodeDecl;
      const k = stmtTypeOf(nd);
      if (k === 'room') roomIds.add(nd.id);
      if (k === 'room' || k === 'furniture' || k === 'door' || k === 'window') allIds.add(nd.id);
    }
    for (const stmt of ast.body) {
      if (stmt.kind !== 'NodeDecl') continue;
      const nd = stmt as ASTNodeDecl;
      const kind = stmtTypeOf(nd);
      const attrs = (nd.style || {}) as Record<string, unknown>;

      if (!kind) {
        out.push({
          severity: 'warning', nodeId: nd.id, line: nd.loc?.startLine, column: nd.loc?.startColumn,
          message: `Unknown floorplan statement "${nd.id}"; expected type: room, door, window or furniture. Skipped.`,
        });
        continue;
      }
      if (kind === 'door' || kind === 'window') {
        const ref = parseRoomRef(attrs.at ?? attrs.on ?? nd.label);
        if (!ref.room || !roomIds.has(ref.room)) {
          out.push({
            severity: 'warning', nodeId: nd.id, line: nd.loc?.startLine, column: nd.loc?.startColumn,
            message: `${kind} "${nd.id}" references unknown room "${ref.room}".`,
          });
        } else if (!ref.edge) {
          out.push({
            severity: 'warning', nodeId: nd.id, line: nd.loc?.startLine, column: nd.loc?.startColumn,
            message: `${kind} "${nd.id}" needs at: "Room.edge" (edge is one of north, south, east, west).`,
          });
        }
      }
      if (kind === 'measure') {
        for (const end of ['from', 'to'] as const) {
          const ref = parseRoomRef(attrs[end]);
          if (!ref.room) {
            out.push({
              severity: 'warning', nodeId: nd.id, line: nd.loc?.startLine, column: nd.loc?.startColumn,
              message: `measure "${nd.id}" needs ${end}: "<id>" or "<Room>.<edge>".`,
            });
          } else if (!allIds.has(ref.room)) {
            out.push({
              severity: 'warning', nodeId: nd.id, line: nd.loc?.startLine, column: nd.loc?.startColumn,
              message: `measure "${nd.id}" references unknown ${end} "${ref.room}".`,
            });
          }
        }
      }
      if (kind === 'furniture') {
        const roomRef = String(attrs.in ?? '').trim();
        if (!roomRef || !roomIds.has(roomRef)) {
          out.push({
            severity: 'warning', nodeId: nd.id, line: nd.loc?.startLine, column: nd.loc?.startColumn,
            message: `furniture "${nd.id}" references unknown room "${roomRef}" via in:.`,
          });
        }
      }
    }
    return out;
  },

  renderNode(node, ctx) {
    return renderFloorplanNode(node, ctx.pad, ctx.swatch);
  },

  getDefaultLayoutOptions() {
    return { direction: 'TB' };
  },
};
