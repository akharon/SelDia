// =============================================================================
// SelDiA — Documentation / Work-Item Diagram Plugin
// =============================================================================
// Requirements, decisions, tests, capabilities, features, stories and risks,
// each with its own sections, linked by typed relationships (`verifies`,
// `satisfies`, `refines`, …). The vocabulary is closed and lives in
// workitem/schema.ts — see the note there for why.
//
// This type earns its place by being *checkable*: `validate()` rejects links
// the schema forbids (a requirement cannot `verify` anything — only a test
// can) and reports requirements with no test covering them. A traceability
// matrix that cannot be wrong is just boxes with arrows.
// =============================================================================

import type { DiagramPlugin, PluginDiagnostic } from '../plugin/types.js';
import type { DiagramAST, ASTNodeDecl, ASTEdgeDecl } from '../ast/nodes.js';
import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
const ROUTING_MAP: Record<string, EdgeRouting> = {
  straight: EdgeRouting.STRAIGHT, spline: EdgeRouting.SPLINE,
  orthogonal: EdgeRouting.ORTHOGONAL, curved: EdgeRouting.CURVED,
};
import { ShapeType } from '../types/shapes.js';
import { StrokeStyle } from '../types/style.js';
import { renderWorkItem, workItemSize } from '../render/workitem-render.js';
import {
  ITEM_KEYWORDS, LINK_KEYWORDS, LINK_RULES, LINK_VERB, VERIFIABLE, sectionsFor,
  type WorkItemType, type WorkItemLink,
} from '../workitem/schema.js';

/** Style keys the renderer owns. Everything else in a node's attribute block is
 *  an item section.
 *
 *  The split is needed because the DSL parser puts *every* attribute-block key
 *  into `style` — `data` exists on the AST but nothing populates it. Rather
 *  than change that shared behaviour (it would touch every diagram type), the
 *  separation happens here, where the schema says which keys are meaningful. */
const STYLE_KEYS = new Set([
  'roughness', 'bowing', 'fillStyle', 'fillWeight', 'hachureAngle', 'hachureGap',
  'stroke', 'strokeWidth', 'strokeDasharray', 'fill', 'opacity',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textColor', 'textAlign',
  'padding', 'minWidth', 'minHeight', 'borderRadius', 'shadow', 'shadowBlur',
]);

/** Read the item type off a declaration.
 *
 *  Authors write the type as the shape keyword (`requirement REQ1 "Login"`) or
 *  as a `type:` field. An unknown or absent type falls back to `requirement`
 *  rather than erroring, so a half-written document still renders — validate()
 *  is where the complaint belongs, not transform(). */
function itemTypeOf(nd: ASTNodeDecl): WorkItemType {
  const attrs = (nd.style || {}) as Record<string, unknown>;
  const declared = String(attrs.type ?? attrs.kind ?? '').toLowerCase();
  if (ITEM_KEYWORDS[declared]) return ITEM_KEYWORDS[declared];
  const cls = (nd.classList || []).map((c) => c.toLowerCase()).find((c) => ITEM_KEYWORDS[c]);
  if (cls) return ITEM_KEYWORDS[cls];
  return 'requirement';
}

/** Split an attribute block into renderer style vs. item sections, keeping only
 *  sections the item's own type declares — an `estimation` on a decision is
 *  dropped rather than silently rendered, because per-type sections are the
 *  point of the schema. Unknown keys are returned separately so validate() can
 *  report them instead of them vanishing without trace. */
function splitAttrs(nd: ASTNodeDecl, type: WorkItemType) {
  const attrs = (nd.style || {}) as Record<string, unknown>;
  const known = new Set(sectionsFor(type).map((s) => s.key));
  const style: Record<string, unknown> = {};
  const fields: Record<string, unknown> = {};
  const unknown: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (STYLE_KEYS.has(k)) style[k] = v;
    else if (k === 'type' || k === 'kind') continue;
    else if (known.has(k)) fields[k] = v;
    else unknown.push(k);
  }
  return { style, fields, unknown };
}

function linkKindOf(ed: ASTEdgeDecl): WorkItemLink | undefined {
  const raw = String(ed.label ?? '').trim().toLowerCase();
  return LINK_KEYWORDS[raw];
}

export const workitemPlugin: DiagramPlugin = {
  id: 'seldia-workitem',
  name: 'Work Item Diagram',
  version: '1.0.0',
  diagramType: DiagramType.WORKITEM,
  description: 'Requirements, decisions, tests and stories with typed traceability links',

  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = [];
    const edges: IREdge[] = [];

    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        const itemType = itemTypeOf(nd);
        const { style, fields } = splitAttrs(nd, itemType);
        nodes.push({
          id: nd.id,
          label: nd.label,
          shape: ShapeType.RECTANGLE,
          position: { x: 0, y: 0 },
          // Sized from the sections the renderer will actually draw, for the
          // same reason ER entities are (erEntitySize): a fixed height leaves
          // links anchored on a border below the visible card.
          size: workItemSize(nd.label, itemType, fields),
          style,
          ports: [],
          classList: nd.classList || [],
          collapsed: false,
          data: { itemType, fields },
        });
      }

      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        const kind = linkKindOf(ed);
        edges.push({
          id: `wi-${ed.sourceId}-${ed.targetId}-${edges.length}`,
          sourceId: ed.sourceId,
          targetId: ed.targetId,
          label: ed.label || undefined,
          style: {
            ...(ed.style || {}),
            // A `conflicts` link is the one relation that says something is
            // wrong, so it reads dashed regardless of how it was written.
            strokeStyle: kind === 'conflicts' ? StrokeStyle.DASHED : StrokeStyle.SOLID,
          },
          routing: (ed.routing && ROUTING_MAP[ed.routing]) || EdgeRouting.ORTHOGONAL,
          bidirectional: false,
          classList: [],
          data: kind ? { linkKind: kind } : {},
        });
      }
    }

    return {
      id: ast.metadata?.id || 'workitem-1',
      type: DiagramType.WORKITEM,
      title: ast.title || 'Work Items',
      nodes, edges, groups: [], layers: [], metadata: {},
    };
  },

  /** The point of the type: a traceability graph that can be wrong, and says so.
   *
   *  Everything here is a *warning*, never an error. A half-written
   *  specification is the normal state of a specification, and refusing to
   *  render one would make the tool useless exactly when it is most needed. */
  validate(ast: DiagramAST): PluginDiagnostic[] {
    const out: PluginDiagnostic[] = [];
    const typeById = new Map<string, WorkItemType>();
    const declared = new Set<string>();

    for (const stmt of ast.body) {
      if (stmt.kind !== 'NodeDecl') continue;
      const nd = stmt as ASTNodeDecl;
      declared.add(nd.id);
      const t = itemTypeOf(nd);
      typeById.set(nd.id, t);

      const attrs = (nd.style || {}) as Record<string, unknown>;
      const rawType = String(attrs.type ?? attrs.kind ?? '').toLowerCase();
      if (rawType && !ITEM_KEYWORDS[rawType]) {
        out.push({
          severity: 'warning', nodeId: nd.id, line: nd.loc?.startLine, column: nd.loc?.startColumn,
          message: `Unknown work-item type "${rawType}"; treated as requirement. Known types: ${[...new Set(Object.values(ITEM_KEYWORDS))].join(', ')}.`,
        });
      }

      const { unknown } = splitAttrs(nd, t);
      for (const key of unknown) {
        out.push({
          severity: 'warning', nodeId: nd.id, line: nd.loc?.startLine, column: nd.loc?.startColumn,
          message: `"${key}" is not a section of a ${t}; it will not be shown. Sections: ${sectionsFor(t).map((s) => s.key).join(', ')}.`,
        });
      }
    }

    const verified = new Set<string>();
    for (const stmt of ast.body) {
      if (stmt.kind !== 'EdgeDecl') continue;
      const ed = stmt as ASTEdgeDecl;
      const raw = String(ed.label ?? '').trim();
      const kind = linkKindOf(ed);

      if (raw && !kind) {
        out.push({
          severity: 'warning', line: ed.loc?.startLine, column: ed.loc?.startColumn,
          message: `Unknown link "${raw}"; drawn as a plain arrow. Known links: ${[...new Set(Object.values(LINK_KEYWORDS))].join(', ')}.`,
        });
        continue;
      }
      if (!kind) continue;
      if (kind === 'verifies') verified.add(ed.targetId);

      const rule = LINK_RULES[kind];
      if (!rule) continue; // `depends` / `conflicts` hold between any two items
      const from = typeById.get(ed.sourceId);
      const to = typeById.get(ed.targetId);
      // An edge to an undeclared id is the analyzer's complaint, not ours.
      if (!from || !to) continue;
      if (!rule.from.includes(from)) {
        out.push({
          severity: 'warning', line: ed.loc?.startLine, column: ed.loc?.startColumn,
          message: `A ${from} cannot ${LINK_VERB[kind]} — only ${rule.from.join(', ')} can. (${ed.sourceId} → ${ed.targetId})`,
        });
      } else if (!rule.to.includes(to)) {
        out.push({
          severity: 'warning', line: ed.loc?.startLine, column: ed.loc?.startColumn,
          message: `${kind} cannot point at a ${to} — only at ${rule.to.join(', ')}. (${ed.sourceId} → ${ed.targetId})`,
        });
      }
    }

    // Coverage: the question a traceability diagram exists to answer.
    for (const [id, t] of typeById) {
      if (VERIFIABLE.includes(t) && !verified.has(id)) {
        out.push({
          severity: 'warning', nodeId: id, code: 'workitem/uncovered',
          message: `${t} "${id}" has no test verifying it.`,
        });
      }
    }

    return out;
  },

  renderNode(node, ctx) {
    return renderWorkItem(node, ctx.pad, ctx.sketchy, ctx.swatch);
  },

  getDefaultLayoutOptions() {
    return { direction: 'TB', nodeSpacing: [90, 80], rankSpacing: 110 };
  },
};
