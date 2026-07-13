// =============================================================================
// SelDiA — Layout Engine Types
// =============================================================================

import type { Direction, Rect, Point } from '@seldia/core/types/common';
import type { DiagramIR, LayoutResult } from '@seldia/core/ir/types';

// -----------------------------------------------------------------------------
// Layout Options
// -----------------------------------------------------------------------------

export interface LayoutOptions {
  /** Layout direction */
  direction: Direction;

  /** Horizontal spacing between nodes */
  nodeHorizontalSpacing: number;

  /** Vertical spacing between nodes */
  nodeVerticalSpacing: number;

  /** Spacing between ranks (for hierarchical layouts) */
  rankSpacing: number;

  /** Spacing used for edge routing clearance */
  edgeSpacing: number;

  /** Whether nodes are allowed to overlap */
  allowOverlap: boolean;

  /** Fixed positions for specific nodes (manual override), keyed by node ID */
  fixedPositions: Record<string, Point>;

  /** Number of iterations (for iterative/force-directed algorithms) */
  maxIterations: number;

  /** Algorithm-specific options bag */
  algorithmOptions: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Layout Engine Interface
// -----------------------------------------------------------------------------

export interface LayoutEngine {
  /** Unique engine identifier */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /**
   * Compute layout for the given diagram IR.
   * Modifies node positions, sizes, and edge waypoints in-place.
   *
   * @param ir - The diagram IR (nodes have initial/zero positions)
   * @param options - Layout options
   * @returns The layout result with positioned elements
   */
  layout(ir: DiagramIR, options: Partial<LayoutOptions>): LayoutResult;

  /**
   * Estimate the diagram bounds without running full layout.
   * Useful for preview / sizing before committing to layout.
   */
  estimateBounds?(ir: DiagramIR, options: Partial<LayoutOptions>): Rect;

  /**
   * Incrementally update layout when nodes are added/removed/moved.
   * Returns only the affected nodes — others keep their positions.
   */
  incrementalLayout?(
    ir: DiagramIR,
    changes: LayoutChange[],
    options: Partial<LayoutOptions>
  ): Partial<LayoutResult>;
}

// -----------------------------------------------------------------------------
// Layout Change (for incremental layout)
// -----------------------------------------------------------------------------

export type LayoutChange =
  | { type: 'add-node'; nodeId: string }
  | { type: 'remove-node'; nodeId: string }
  | { type: 'move-node'; nodeId: string; position: Point }
  | { type: 'add-edge'; edgeId: string }
  | { type: 'remove-edge'; edgeId: string }
  | { type: 'resize-node'; nodeId: string; size: { width: number; height: number } };

// -----------------------------------------------------------------------------
// Edge Router Interface
// -----------------------------------------------------------------------------

export interface EdgeRouter {
  /** Unique router identifier */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /**
   * Compute waypoints for an edge between two nodes.
   *
   * @param source - Source node bounds
   * @param target - Target node bounds
   * @param existingEdges - Other edges already routed (for avoidance)
   * @param options - Routing options
   * @returns Array of waypoints (including start and end points)
   */
  route(
    source: { bounds: Rect; ports: Point[] },
    target: { bounds: Rect; ports: Point[] },
    existingEdges: Array<{ waypoints: Point[] }>,
    options: EdgeRoutingOptions
  ): Point[];
}

export interface EdgeRoutingOptions {
  /** Minimum clearance from other edges */
  clearance: number;

  /** Corner radius for orthogonal routing */
  cornerRadius: number;

  /** Whether to use port-based routing (attach to specific ports) */
  usePorts: boolean;
}

// -----------------------------------------------------------------------------
// Label Placer Interface
// -----------------------------------------------------------------------------

export interface LabelPlacer {
  /**
   * Find optimal position for an edge label along the edge path.
   *
   * @param waypoints - The edge waypoints
   * @param labelSize - Approximate size of the label text
   * @param existingLabels - Already placed labels (for avoidance)
   * @returns The label position and rotation
   */
  place(
    waypoints: Point[],
    labelSize: { width: number; height: number },
    existingLabels: Array<{ position: Point; size: { width: number; height: number } }>
  ): { position: Point; rotation: number };
}

// -----------------------------------------------------------------------------
// Layout Engine Factory
// -----------------------------------------------------------------------------

export interface LayoutEngineFactory {
  /** Create a layout engine by ID */
  create(id: string): LayoutEngine | undefined;

  /** Register a custom layout engine */
  register(engine: LayoutEngine): void;

  /** List available layout engines */
  list(): ReadonlyArray<LayoutEngine>;
}
