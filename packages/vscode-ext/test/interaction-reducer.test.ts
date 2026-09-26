import { describe, it, expect } from 'vitest';
import { reduceInteraction, initialInteractionState } from '../src/webview/client/interaction-reducer.js';

describe('reduceInteraction', () => {
  it('selects a node on click', () => {
    const r = reduceInteraction(initialInteractionState(), { type: 'CLICK_NODE', id: 'n1' });
    expect(r.state.selectedNodeId).toBe('n1');
    expect(r.state.mode).toBe('selected');
  });

  it('starts edge draw on toggle, then sets source on first node click', () => {
    let s = initialInteractionState();
    s = reduceInteraction(s, { type: 'TOGGLE_EDGE_DRAW' }).state;
    expect(s.mode).toBe('drawing-edge');
    const r2 = reduceInteraction(s, { type: 'CLICK_NODE', id: 'a' });
    expect(r2.state.edgeDrawSourceId).toBe('a');
    expect(r2.effects).toContainEqual({ type: 'markEdgeSource', id: 'a' });
  });

  it('completes edge on second distinct node click', () => {
    let s = initialInteractionState();
    s = reduceInteraction(s, { type: 'TOGGLE_EDGE_DRAW' }).state;
    s = reduceInteraction(s, { type: 'CLICK_NODE', id: 'a' }).state;
    const r = reduceInteraction(s, { type: 'CLICK_NODE', id: 'b' });
    expect(r.state.mode).toBe('idle');
    expect(r.state.edgeDrawSourceId).toBeNull();
    expect(r.effects).toContainEqual({ type: 'postEdgeAdded', sourceId: 'a', targetId: 'b' });
  });

  it('clicking the same node again in drawing-edge mode is a no-op', () => {
    let s = initialInteractionState();
    s = reduceInteraction(s, { type: 'TOGGLE_EDGE_DRAW' }).state;
    s = reduceInteraction(s, { type: 'CLICK_NODE', id: 'a' }).state;
    const r = reduceInteraction(s, { type: 'CLICK_NODE', id: 'a' });
    expect(r.state).toEqual(s);
    expect(r.effects).toEqual([]);
  });

  it('escape resets mode and selection', () => {
    let s = initialInteractionState();
    s = reduceInteraction(s, { type: 'CLICK_NODE', id: 'a' }).state;
    const r = reduceInteraction(s, { type: 'ESCAPE' });
    expect(r.state.mode).toBe('idle');
    expect(r.state.selectedNodeId).toBeNull();
  });

  it('toggle edge draw off clears source', () => {
    let s = initialInteractionState();
    s = reduceInteraction(s, { type: 'TOGGLE_EDGE_DRAW' }).state;
    s = reduceInteraction(s, { type: 'CLICK_NODE', id: 'a' }).state;
    const r = reduceInteraction(s, { type: 'TOGGLE_EDGE_DRAW' });
    expect(r.state.mode).toBe('idle');
    expect(r.state.edgeDrawSourceId).toBeNull();
  });

  it('click empty clears selection outside edge-draw mode', () => {
    let s = initialInteractionState();
    s = reduceInteraction(s, { type: 'CLICK_NODE', id: 'a' }).state;
    const r = reduceInteraction(s, { type: 'CLICK_EMPTY' });
    expect(r.state.selectedNodeId).toBeNull();
  });

  it('click empty during edge-draw with no source picked is a no-op', () => {
    let s = initialInteractionState();
    s = reduceInteraction(s, { type: 'TOGGLE_EDGE_DRAW' }).state;
    const r = reduceInteraction(s, { type: 'CLICK_EMPTY' });
    expect(r.state).toEqual(s);
  });

  it('click empty during edge-draw with a source picked offers create-connected-node', () => {
    let s = initialInteractionState();
    s = reduceInteraction(s, { type: 'TOGGLE_EDGE_DRAW' }).state;
    s = reduceInteraction(s, { type: 'CLICK_NODE', id: 'a' }).state;
    const r = reduceInteraction(s, { type: 'CLICK_EMPTY' });
    expect(r.state.mode).toBe('idle');
    expect(r.state.edgeDrawSourceId).toBeNull();
    expect(r.effects).toContainEqual({ type: 'postCreateConnectedNode', sourceId: 'a' });
  });

  it('START_RECONNECT enters reconnecting-edge mode', () => {
    const r = reduceInteraction(initialInteractionState(), { type: 'START_RECONNECT', edgeId: 'e1', end: 'target' });
    expect(r.state.mode).toBe('reconnecting-edge');
    expect(r.state.reconnectingEdgeId).toBe('e1');
    expect(r.state.reconnectingEnd).toBe('target');
    expect(r.effects).toContainEqual({ type: 'setReconnectingActive', active: true });
  });

  it('clicking a node while reconnecting posts postEdgeReconnected and returns to idle', () => {
    let s = initialInteractionState();
    s = reduceInteraction(s, { type: 'START_RECONNECT', edgeId: 'e1', end: 'source' }).state;
    const r = reduceInteraction(s, { type: 'CLICK_NODE', id: 'n9' });
    expect(r.state.mode).toBe('idle');
    expect(r.state.reconnectingEdgeId).toBeNull();
    expect(r.state.reconnectingEnd).toBeNull();
    expect(r.effects).toContainEqual({ type: 'postEdgeReconnected', edgeId: 'e1', end: 'source', newId: 'n9' });
    expect(r.effects).toContainEqual({ type: 'setReconnectingActive', active: false });
  });

  it('clicking an edge while reconnecting is a no-op', () => {
    let s = initialInteractionState();
    s = reduceInteraction(s, { type: 'START_RECONNECT', edgeId: 'e1', end: 'source' }).state;
    const r = reduceInteraction(s, { type: 'CLICK_EDGE', id: 'e2' });
    expect(r.state).toEqual(s);
    expect(r.effects).toEqual([]);
  });

  it('click empty while reconnecting is a no-op', () => {
    let s = initialInteractionState();
    s = reduceInteraction(s, { type: 'START_RECONNECT', edgeId: 'e1', end: 'source' }).state;
    const r = reduceInteraction(s, { type: 'CLICK_EMPTY' });
    expect(r.state).toEqual(s);
    expect(r.effects).toEqual([]);
  });

  it('escape cancels reconnecting-edge mode', () => {
    let s = initialInteractionState();
    s = reduceInteraction(s, { type: 'START_RECONNECT', edgeId: 'e1', end: 'source' }).state;
    const r = reduceInteraction(s, { type: 'ESCAPE' });
    expect(r.state.mode).toBe('idle');
    expect(r.state.reconnectingEdgeId).toBeNull();
    expect(r.state.reconnectingEnd).toBeNull();
    expect(r.effects).toContainEqual({ type: 'setReconnectingActive', active: false });
  });

  it('TOGGLE_EDGE_DRAW while reconnecting switches cleanly into drawing-edge mode', () => {
    let s = initialInteractionState();
    s = reduceInteraction(s, { type: 'START_RECONNECT', edgeId: 'e1', end: 'source' }).state;
    const r = reduceInteraction(s, { type: 'TOGGLE_EDGE_DRAW' });
    expect(r.state.mode).toBe('drawing-edge');
    expect(r.state.reconnectingEdgeId).toBeNull();
    expect(r.state.reconnectingEnd).toBeNull();
  });
});
