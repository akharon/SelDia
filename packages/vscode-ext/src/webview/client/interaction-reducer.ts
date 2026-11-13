// =============================================================================
// SelDiA — Pure interaction-mode reducer
// =============================================================================
// The webview client (`editor.ts`) mixes DOM/canvas code with a handful of
// mode decisions: whether a click starts/completes an edge draw, what Escape
// resets, and when the "Add Edge" toolbar button should toggle. Those
// decisions were previously inline `if`s scattered across click/keydown/
// context-menu handlers with no test coverage.
//
// This module pulls just the *mode transition* logic out as a pure
// `(state, event) -> (state, effects[])` reducer — no DOM, no vscode API — so
// it can be unit tested directly. `editor.ts` still owns all DOM/canvas work;
// it calls `reduceInteraction` and applies the returned effects imperatively.
// This is intentionally a partial extraction: drag geometry, floorplan guide
// math, and zoom/pan stay inline in editor.ts.
// =============================================================================

export type InteractionMode = 'idle' | 'selected' | 'drawing-edge' | 'reconnecting-edge';

export interface InteractionState {
  mode: InteractionMode;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  edgeDrawSourceId: string | null;
  /** Set while mode === 'reconnecting-edge': which edge/end is being moved. */
  reconnectingEdgeId: string | null;
  reconnectingEnd: 'source' | 'target' | null;
}

export function initialInteractionState(): InteractionState {
  return {
    mode: 'idle',
    selectedNodeId: null,
    selectedEdgeId: null,
    edgeDrawSourceId: null,
    reconnectingEdgeId: null,
    reconnectingEnd: null,
  };
}

export type InteractionEvent =
  | { type: 'CLICK_NODE'; id: string }
  | { type: 'CLICK_EDGE'; id: string }
  | { type: 'CLICK_EMPTY' }
  | { type: 'TOGGLE_EDGE_DRAW' }
  | { type: 'START_RECONNECT'; edgeId: string; end: 'source' | 'target' }
  | { type: 'ESCAPE' }
  | { type: 'SET_MODE'; mode: InteractionMode }
  | { type: 'SELECT_NODE'; id: string | null };

export type InteractionEffect =
  | { type: 'selectNode'; id: string }
  | { type: 'selectEdge'; id: string }
  | { type: 'clearSelection' }
  | { type: 'markEdgeSource'; id: string }
  | { type: 'clearEdgeSource' }
  | { type: 'postEdgeAdded'; sourceId: string; targetId: string }
  | { type: 'postCreateConnectedNode'; sourceId: string }
  | { type: 'postEdgeReconnected'; edgeId: string; end: 'source' | 'target'; newId: string }
  | { type: 'setAddEdgeButtonActive'; active: boolean }
  | { type: 'setReconnectingActive'; active: boolean }
  | { type: 'closeOverlays' };

export interface ReduceResult {
  state: InteractionState;
  effects: InteractionEffect[];
}

/**
 * Advance interaction state by one event. Pure — callers apply the returned
 * effects (DOM classes, attribute toggles, postMessage) themselves.
 */
export function reduceInteraction(state: InteractionState, event: InteractionEvent): ReduceResult {
  switch (event.type) {
    case 'CLICK_NODE': {
      if (state.mode === 'reconnecting-edge') {
        if (state.reconnectingEdgeId && state.reconnectingEnd) {
          return {
            state: { ...state, mode: 'idle', reconnectingEdgeId: null, reconnectingEnd: null },
            effects: [
              { type: 'postEdgeReconnected', edgeId: state.reconnectingEdgeId, end: state.reconnectingEnd, newId: event.id },
              { type: 'setReconnectingActive', active: false },
            ],
          };
        }
        return { state, effects: [] };
      }
      if (state.mode === 'drawing-edge') {
        if (!state.edgeDrawSourceId) {
          return {
            state: { ...state, edgeDrawSourceId: event.id },
            effects: [{ type: 'markEdgeSource', id: event.id }],
          };
        }
        if (state.edgeDrawSourceId !== event.id) {
          return {
            state: { ...state, mode: 'idle', edgeDrawSourceId: null },
            effects: [
              { type: 'postEdgeAdded', sourceId: state.edgeDrawSourceId, targetId: event.id },
              { type: 'clearEdgeSource' },
              { type: 'setAddEdgeButtonActive', active: false },
            ],
          };
        }
        // Clicking the source node again is a no-op — stay in drawing-edge.
        return { state, effects: [] };
      }
      return {
        state: { ...state, mode: 'selected', selectedNodeId: event.id, selectedEdgeId: null },
        effects: [{ type: 'clearSelection' }, { type: 'selectNode', id: event.id }],
      };
    }

    case 'CLICK_EDGE': {
      if (state.mode === 'drawing-edge' || state.mode === 'reconnecting-edge') return { state, effects: [] };
      return {
        state: { ...state, mode: 'selected', selectedEdgeId: event.id, selectedNodeId: null },
        effects: [{ type: 'clearSelection' }, { type: 'selectEdge', id: event.id }],
      };
    }

    case 'CLICK_EMPTY': {
      if (state.mode === 'reconnecting-edge') return { state, effects: [] };
      if (state.mode === 'drawing-edge') {
        // A source is already picked and the user dropped on open canvas
        // instead of a node — offer "create connected node here" rather
        // than silently doing nothing.
        if (state.edgeDrawSourceId) {
          return {
            state: { ...state, mode: 'idle', edgeDrawSourceId: null },
            effects: [
              { type: 'postCreateConnectedNode', sourceId: state.edgeDrawSourceId },
              { type: 'clearEdgeSource' },
              { type: 'setAddEdgeButtonActive', active: false },
            ],
          };
        }
        return { state, effects: [] };
      }
      if (!state.selectedNodeId && !state.selectedEdgeId) return { state, effects: [] };
      return {
        state: { ...state, selectedNodeId: null, selectedEdgeId: null },
        effects: [{ type: 'clearSelection' }],
      };
    }

    case 'TOGGLE_EDGE_DRAW': {
      if (state.mode === 'drawing-edge') {
        return {
          state: { ...state, mode: 'idle', edgeDrawSourceId: null },
          effects: [{ type: 'clearEdgeSource' }, { type: 'setAddEdgeButtonActive', active: false }],
        };
      }
      return {
        state: { ...state, mode: 'drawing-edge', edgeDrawSourceId: null, reconnectingEdgeId: null, reconnectingEnd: null },
        effects: [{ type: 'setAddEdgeButtonActive', active: true }],
      };
    }

    case 'START_RECONNECT': {
      return {
        state: { ...state, mode: 'reconnecting-edge', reconnectingEdgeId: event.edgeId, reconnectingEnd: event.end, edgeDrawSourceId: null },
        effects: [{ type: 'setReconnectingActive', active: true }],
      };
    }

    case 'ESCAPE': {
      return {
        state: {
          ...state,
          mode: 'idle',
          edgeDrawSourceId: null,
          selectedNodeId: null,
          selectedEdgeId: null,
          reconnectingEdgeId: null,
          reconnectingEnd: null,
        },
        effects: [
          { type: 'clearSelection' },
          { type: 'clearEdgeSource' },
          { type: 'setAddEdgeButtonActive', active: false },
          { type: 'setReconnectingActive', active: false },
          { type: 'closeOverlays' },
        ],
      };
    }

    case 'SET_MODE': {
      return { state: { ...state, mode: event.mode }, effects: [] };
    }

    case 'SELECT_NODE': {
      return {
        state: { ...state, selectedNodeId: event.id, selectedEdgeId: null, mode: event.id ? 'selected' : 'idle' },
        effects: event.id ? [{ type: 'clearSelection' }, { type: 'selectNode', id: event.id }] : [{ type: 'clearSelection' }],
      };
    }
  }
}
