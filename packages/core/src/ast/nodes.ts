// =============================================================================
// SelDiA — AST Node Types
// =============================================================================
// Abstract Syntax Tree nodes produced by the DSL parser.
// These are DIAGRAM-TYPE-AGNOSTIC at the root level.
// Each diagram type plugin extends these with specific node types.

import type { ID, SourceLocation } from '../types/common.js';
import type { DiagramType } from '../ir/types.js';
import type { ShapeType } from '../types/shapes.js';
import type { NodeStyle, EdgeStyle, GroupStyle, Theme } from '../types/style.js';

// -----------------------------------------------------------------------------
// Base AST Node
// -----------------------------------------------------------------------------

export interface ASTNode {
  kind: string;
  loc: SourceLocation;
}

// -----------------------------------------------------------------------------
// Diagram AST — root node
// -----------------------------------------------------------------------------

export interface DiagramAST extends ASTNode {
  kind: 'Diagram';
  type: DiagramType;
  title?: string;
  metadata: ASTMetadata;
  body: ASTStatement[];
  /** Verbatim fence body for types whose source is not SelDiA DSL (circuit netlists). */
  raw?: string;
  /** 1-based source line `raw` starts on. */
  rawLine?: number;
}

export interface ASTMetadata {
  id?: string;
  author?: string;
  version?: string;
  date?: string;
  tags?: string[];
  description?: string;
}

// -----------------------------------------------------------------------------
// Statements (top-level inside diagram body)
// -----------------------------------------------------------------------------

export type ASTStatement =
  | ASTThemeDecl
  | ASTLayoutDecl
  | ASTEdgeStyleDecl
  | ASTStyleDecl
  | ASTNodeDecl
  | ASTEdgeDecl
  | ASTGroupDecl
  | ASTSectionDecl
  | ASTFragmentMarker
  | ASTComment;

// -----------------------------------------------------------------------------
// Theme Declaration
// -----------------------------------------------------------------------------

export interface ASTThemeDecl extends ASTNode {
  kind: 'ThemeDecl';
  /** Either a theme name string or an inline theme definition */
  theme: string | Theme;
}

// -----------------------------------------------------------------------------
// Layout Declaration
// -----------------------------------------------------------------------------

/** `edges sketch|clean`: per-diagram edge drawing style (overrides config render.edgeStyle). */
export interface ASTEdgeStyleDecl extends ASTNode {
  kind: 'EdgeStyleDecl';
  style: 'sketch' | 'clean';
}

export interface ASTLayoutDecl extends ASTNode {
  kind: 'LayoutDecl';
  engine: string;
  options: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Style Block (inline style on a node/edge/group)
// -----------------------------------------------------------------------------

export interface ASTStyleDecl extends ASTNode {
  kind: 'StyleDecl';
  target: 'node' | 'edge' | 'group' | 'all';
  style: Partial<NodeStyle & EdgeStyle & GroupStyle>;
}

// -----------------------------------------------------------------------------
// Node Declaration
// -----------------------------------------------------------------------------

export interface ASTNodeDecl extends ASTNode {
  kind: 'NodeDecl';
  id: ID;
  shape: ShapeType;
  label: string;
  description?: string;
  style?: Partial<NodeStyle>;
  layout?: ASTLayoutHints;
  classList?: string[];
  data?: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Edge Declaration
// -----------------------------------------------------------------------------

export type ArrowDirection = 'right' | 'left' | 'both' | 'none';

export interface ASTEdgeDecl extends ASTNode {
  kind: 'EdgeDecl';
  sourceId: ID;
  targetId: ID;
  direction: ArrowDirection;
  label?: string;
  label2?: string;
  style?: Partial<EdgeStyle>;
  routing?: 'straight' | 'spline' | 'orthogonal' | 'curved';
  layout?: ASTLayoutHints;
  classList?: string[];
  data?: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Group Declaration
// -----------------------------------------------------------------------------

export interface ASTGroupDecl extends ASTNode {
  kind: 'GroupDecl';
  id: ID;
  label: string;
  style?: Partial<GroupStyle>;
  body: ASTStatement[];
  collapsible: boolean;
  classList?: string[];
  data?: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Section Declaration (logical grouping of elements)
// -----------------------------------------------------------------------------

export interface ASTSectionDecl extends ASTNode {
  kind: 'SectionDecl';
  id: ID;
  label: string;
  body: ASTStatement[];
}

// -----------------------------------------------------------------------------
// Comment
// -----------------------------------------------------------------------------

export interface ASTComment extends ASTNode {
  kind: 'Comment';
  text: string;
}

// -----------------------------------------------------------------------------
// Sequence control-fragment marker (alt/else/opt/loop/par/critical/break/end)
// -----------------------------------------------------------------------------
// A fragment brackets a range of messages rather than declaring a node, so it
// can't be an IRNode or an IRGroup (both bound *nodes*). It's carried as a
// statement marker; the sequence plugin pairs opens with their `end` and the
// layout/renderer draws the box from the messages nested between them.
export interface ASTFragmentMarker extends ASTNode {
  kind: 'FragmentMarker';
  /** Normalized keyword: alt | else | opt | loop | par | critical | break | end */
  keyword: string;
  /** The condition/label text after the keyword, if any (`alt valid` → "valid"). */
  label?: string;
}

// -----------------------------------------------------------------------------
// Layout Hints (user-provided positioning constraints)
// -----------------------------------------------------------------------------

export interface ASTLayoutHints {
  /** Fixed position (manual override) */
  x?: number;
  y?: number;
  /** Keep in same row/column as another node (for tabular layouts) */
  sameRow?: ID;
  sameColumn?: ID;
  /** Preferred relative position */
  align?: 'top' | 'bottom' | 'left' | 'right';
  /** Spacing override */
  margin?: number;
}

// -----------------------------------------------------------------------------
// Visitor Pattern Interface
// -----------------------------------------------------------------------------

export interface ASTVisitor<T = void> {
  visitDiagram?(node: DiagramAST): T;
  visitThemeDecl?(node: ASTThemeDecl): T;
  visitLayoutDecl?(node: ASTLayoutDecl): T;
  visitStyleDecl?(node: ASTStyleDecl): T;
  visitNodeDecl?(node: ASTNodeDecl): T;
  visitEdgeDecl?(node: ASTEdgeDecl): T;
  visitGroupDecl?(node: ASTGroupDecl): T;
  visitSectionDecl?(node: ASTSectionDecl): T;
  visitComment?(node: ASTComment): T;
}

/** Walk an AST, calling the visitor for each node */
export function walkAST(ast: DiagramAST, visitor: ASTVisitor): void {
  function visit(node: ASTNode): void {
    switch (node.kind) {
      case 'Diagram':
        visitor.visitDiagram?.(node as DiagramAST);
        (node as DiagramAST).body.forEach(n => visit(n as ASTNode));
        break;
      case 'ThemeDecl':
        visitor.visitThemeDecl?.(node as ASTThemeDecl);
        break;
      case 'LayoutDecl':
        visitor.visitLayoutDecl?.(node as ASTLayoutDecl);
        break;
      case 'StyleDecl':
        visitor.visitStyleDecl?.(node as ASTStyleDecl);
        break;
      case 'NodeDecl':
        visitor.visitNodeDecl?.(node as ASTNodeDecl);
        break;
      case 'EdgeDecl':
        visitor.visitEdgeDecl?.(node as ASTEdgeDecl);
        break;
      case 'GroupDecl': {
        visitor.visitGroupDecl?.(node as ASTGroupDecl);
        (node as ASTGroupDecl).body.forEach(n => visit(n as ASTNode));
        break;
      }
      case 'SectionDecl': {
        visitor.visitSectionDecl?.(node as ASTSectionDecl);
        (node as ASTSectionDecl).body.forEach(n => visit(n as ASTNode));
        break;
      }
      case 'Comment':
        visitor.visitComment?.(node as ASTComment);
        break;
    }
  }
  visit(ast);
}
