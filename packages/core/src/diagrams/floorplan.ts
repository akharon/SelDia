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

export type FloorplanStmtType = 'room' | 'door' | 'window' | 'furniture' | 'sheet';

const STMT_KEYWORDS: Record<string, FloorplanStmtType> = {
  room: 'room', r: 'room',
  door: 'door', d: 'door',
  window: 'window', win: 'window', w: 'window',
  furniture: 'furniture', item: 'furniture', fixture: 'furniture',
  sheet: 'sheet', titleblock: 'sheet',
};

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

    // Title-block fields: `sheet { scale: "1:100", author: "...", date: "..." }`
    // is a one-off statement, not a room/door/etc — its attrs are read once,
    // below, rather than pushed onto `nodes`. ast.metadata is always `{}` at
    // parse time (this DSL has no `key: value` diagram-header syntax), so the
    // sheet block is the only way to carry this beyond the title string.
    const titleBlock: { title?: string; scale?: string; author?: string; date?: string } = { title: ast.title };

    for (const stmt of ast.body) {
      if (stmt.kind !== 'NodeDecl') continue;
      const nd = stmt as ASTNodeDecl;
      const kind = stmtTypeOf(nd);
      const attrs = (nd.style || {}) as Record<string, unknown>;

      if (kind === 'sheet') {
        if (attrs.scale) titleBlock.scale = String(attrs.scale);
        if (attrs.author) titleBlock.author = String(attrs.author);
        if (attrs.date) titleBlock.date = String(attrs.date);
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
          data: { fpKind: kind, roomId: ref.room, edge: ref.edge, offset, width },
        });
      } else if (kind === 'furniture') {
        const roomRef = String(attrs.in ?? '').trim();
        const at = parsePoint(attrs.at) || { x: 0, y: 0 };
        const spec = catalogItem(String(attrs.item ?? nd.label ?? ''));
        const sizeOverride = parseSize(attrs.size);
        nodes.push({
          id: nd.id,
          label: spec.label,
          shape: ShapeType.RECTANGLE,
          position: { x: 0, y: 0 }, // room-relative `at`, resolved by layoutFloorplan
          size: { width: sizeOverride?.width ?? spec.width, height: sizeOverride?.height ?? spec.depth },
          style: {},
          ports: [],
          classList: nd.classList || [],
          collapsed: false,
          data: { fpKind: 'furniture', roomId: roomRef, at, symbol: spec.symbol, catalogKey: spec.key },
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
      metadata: { titleBlock: { ...titleBlock, title: titleBlock.title || 'Floor Plan' } },
    };
  },

  validate(ast: DiagramAST): PluginDiagnostic[] {
    const out: PluginDiagnostic[] = [];
    const roomIds = new Set<string>();
    for (const stmt of ast.body) {
      if (stmt.kind !== 'NodeDecl') continue;
      const nd = stmt as ASTNodeDecl;
      if (stmtTypeOf(nd) === 'room') roomIds.add(nd.id);
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
