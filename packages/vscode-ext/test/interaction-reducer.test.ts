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

  it('click empty during edge-draw is a no-op', () => {
    let s = initialInteractionState();
    s = reduceInteraction(s, { type: 'TOGGLE_EDGE_DRAW' }).state;
    const r = reduceInteraction(s, { type: 'CLICK_EMPTY' });
    expect(r.state).toEqual(s);
  });
});
