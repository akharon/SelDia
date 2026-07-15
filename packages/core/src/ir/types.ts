// =============================================================================
// SelDiA — Intermediate Representation (IR) Types
// =============================================================================
// The Diagram IR is the universal format between AST parsing and rendering.
// All diagram-type plugins transform their AST into this IR.

import type { ID, Point, Rect, Size } from '../types/common.js';
import type { ShapeType, Port, PortPosition } from '../types/shapes.js';
import type { NodeStyle, EdgeStyle, GroupStyle } from '../types/style.js';

// -----------------------------------------------------------------------------
// Diagram Type Enum
// -----------------------------------------------------------------------------

export enum DiagramType {
  FLOWCHART = 'flowchart',
  SEQUENCE = 'sequence',
  CLASS = 'class',
  ER = 'er',
  STATE = 'state',
  USECASE = 'usecase',
  ACTIVITY = 'activity',
  COMPONENT = 'component',
  DEPLOYMENT = 'deployment',
  C4_CONTEXT = 'c4-context',
  C4_CONTAINER = 'c4-container',
  C4_COMPONENT = 'c4-component',
  C4_CODE = 'c4-code',
  BPMN = 'bpmn',
  DMN = 'dmn',
  GANTT = 'gantt',
  MINDMAP = 'mindmap',
  NETWORK = 'network',
  CHART_BAR = 'chart-bar',
  CHART_LINE = 'chart-line',
  CHART_PIE = 'chart-pie',
  CHART_RADAR = 'chart-radar',
  CHART_SCATTER = 'chart-scatter',
  GITGRAPH = 'gitgraph',
  FORM = 'form',
  SANKEY = 'sankey',
  BLOCK = 'block',
  TIMELINE = 'timeline',
  WIREFRAME = 'wireframe',
  CLOUD = 'cloud',
}

// -----------------------------------------------------------------------------
// Diagram IR — Top Level
// -----------------------------------------------------------------------------

export interface DiagramIR {
  /** Unique diagram ID */
  id: ID;

  /** Diagram type */
  type: DiagramType;

  /** Human-readable title */
  title?: string;

  /** All nodes in the diagram */
  nodes: IRNode[];

  /** All edges (connections) */
  edges: IREdge[];

  /** All groups (containers) */
  groups: IRGroup[];

  /** Layers for z-ordering */
  layers: IRLayer[];

  /** Diagram dimensions after layout (set by layout engine) */
  bounds?: Rect;

  /** Arbitrary diagram-type-specific data */
  metadata: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// IR Node
// -----------------------------------------------------------------------------

export interface IRNode {
  /** Unique node ID */
  id: ID;

  /** Display label (may contain newlines) */
  label: string;

  /** Secondary label / description (smaller text below label) */
  description?: string;

  /** Shape type */
  shape: ShapeType;

  /** Position (set by layout engine) */
  position: Point;

  /** Dimensions (computed during layout) */
  size: Size;

  /** Visual style */
  style: Partial<NodeStyle>;

  /** Parent group ID, if nested */
  parentId?: ID;

  /** Ports (connection points) */
  ports: Port[];

  /** Z-index layer ID */
  layerId?: ID;

  /** CSS classes for custom styling */
  classList: string[];

  /** Whether the node is collapsed (for expandable containers) */
  collapsed: boolean;

  /** Plugin-specific data bag */
  data: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// IR Edge
// -----------------------------------------------------------------------------

export enum EdgeRouting {
  STRAIGHT = 'straight',
  SPLINE = 'spline',
  ORTHOGONAL = 'orthogonal',
  CURVED = 'curved',
}

export interface IREdge {
  /** Unique edge ID */
  id: ID;

  /** Source node ID */
  sourceId: ID;

  /** Source port (optional — auto-selected if not set) */
  sourcePort?: PortPosition;

  /** Target node ID */
  targetId: ID;

  /** Target port */
  targetPort?: PortPosition;

  /** Edge label */
  label?: string;

  /** Secondary label (e.g., multiplicity) */
  label2?: string;

  /** Visual style */
  style: Partial<EdgeStyle>;

  /** Edge routing algorithm */
  routing: EdgeRouting;

  /** Computed waypoints (set by edge router) */
  waypoints?: Point[];

  /** Z-index layer */
  layerId?: ID;

  /** Whether the edge is bidirectional */
  bidirectional: boolean;

  /** CSS classes */
  classList: string[];

  /** Plugin-specific data bag */
  data: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// IR Group
// -----------------------------------------------------------------------------

export interface IRGroup {
  /** Unique group ID */
  id: ID;

  /** Display label */
  label: string;

  /** Position */
  position: Point;

  /** Size (computed from children + padding) */
  size: Size;

  /** Visual style */
  style: Partial<GroupStyle>;

  /** IDs of child nodes */
  childNodeIds: ID[];

  /** IDs of directly nested child groups */
  childGroupIds: ID[];

  /** Z-index layer */
  layerId?: ID;

  /** Whether the group can be collapsed */
  collapsible: boolean;

  /** Whether currently collapsed */
  collapsed: boolean;

  /** CSS classes */
  classList: string[];

  /** Plugin-specific data bag */
  data: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// IR Layer
// -----------------------------------------------------------------------------

export interface IRLayer {
  /** Unique layer ID */
  id: ID;

  /** Display name */
  name: string;

  /** Z-index (higher = on top) */
  zIndex: number;

  /** Whether the layer is visible */
  visible: boolean;
}

// -----------------------------------------------------------------------------
// Layout Result — output of the layout engine
// -----------------------------------------------------------------------------

export interface LayoutResult {
  /** The positioned diagram IR */
  diagram: DiagramIR;

  /** Total diagram dimensions */
  bounds: Rect;

  /** Warnings from the layout engine */
  warnings: LayoutWarning[];
}

export interface LayoutWarning {
  message: string;
  nodeIds?: ID[];
  edgeIds?: ID[];
}

// -----------------------------------------------------------------------------
// Render Result — output of the render engine
// -----------------------------------------------------------------------------

export interface RenderResult {
  /** SVG markup string */
  svg: string;

  /** Diagram dimensions */
  width: number;
  height: number;

  /** Render statistics */
  stats: RenderStats;
}

export interface RenderStats {
  /** Number of nodes rendered */
  nodeCount: number;

  /** Number of edges rendered */
  edgeCount: number;

  /** Number of groups rendered */
  groupCount: number;

  /** Time spent in milliseconds */
  renderTimeMs: number;
}

// -----------------------------------------------------------------------------
// Diagram Metadata — parsed from DSL header
// -----------------------------------------------------------------------------

export interface DiagramMetadata {
  title?: string;
  author?: string;
  version?: string;
  date?: string;
  tags?: string[];
  description?: string;
}
