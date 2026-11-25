// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { GAP_MS, nextAnimMode, planGlowWalk, type WalkEdge } from '../src/markdown-preview/glow-walk.js';

const e = (id: string, src: string, tgt: string, dur = 100): WalkEdge => ({ id, src, tgt, dur });
const at = (steps: { id: string; start: number; end: number }[]) => Object.fromEntries(steps.map((s) => [s.id, [s.start, s.end]]));

describe('planGlowWalk', () => {
  it('sequence: messages one after another, in order', () => {
    const p = planGlowWalk([e('m1', 'a', 'b'), e('m2', 'b', 'a', 50), e('m3', 'a', 'c')], true);
    expect(at(p)).toEqual({ m1: [0, 100], m2: [100 + GAP_MS, 150 + GAP_MS], m3: [150 + 2 * GAP_MS, 250 + 2 * GAP_MS] });
  });

  it('graph: light splits at a junction and each branch runs in parallel', () => {
    const p = at(planGlowWalk([e('ab', 'a', 'b'), e('ac', 'a', 'c'), e('bd', 'b', 'd'), e('cd', 'c', 'd', 300)], false));
    expect(p.ab).toEqual([0, 100]);
    expect(p.ac).toEqual([0, 100]);
    expect(p.bd).toEqual([100, 200]);
    expect(p.cd).toEqual([100, 400]); // the join still lights its slower edge
  });

  it('downstream starts at the FIRST arrival and each edge walks once', () => {
    const p = at(planGlowWalk([e('ab', 'a', 'b', 500), e('ac', 'a', 'c'), e('cb', 'c', 'b'), e('bx', 'b', 'x')], false));
    expect(p.bx).toEqual([200, 300]);
  });

  it('terminates on cycles and seeds components no root reaches', () => {
    const p = planGlowWalk([e('ab', 'a', 'b'), e('ba', 'b', 'a'), e('rs', 'r', 's'), e('xy', 'x', 'y'), e('yx', 'y', 'x')], false);
    expect(p).toHaveLength(5);
    const s = at(p);
    expect(s.rs).toEqual([0, 100]); // r is the only true root
    expect(s.ab[0]).toBeGreaterThan(100); // pure cycles run after
    expect(s.ba[0]).toBe(s.ab[1]);
    expect(s.xy[0]).toBeGreaterThan(s.ba[1]);
  });
});

describe('nextAnimMode', () => {
  it('cycles paused → play → glow → paused', () => {
    expect(nextAnimMode('paused', true)).toBe('play');
    expect(nextAnimMode('play', true)).toBe('glow');
    expect(nextAnimMode('glow', true)).toBe('paused');
  });
  it('skips glow when there is nothing to walk', () => {
    expect(nextAnimMode('play', false)).toBe('paused');
  });
});
