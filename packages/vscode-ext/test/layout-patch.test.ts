import { describe, it, expect } from 'vitest';
import { computeLayoutGestureEdits, computeAutoLayoutEdits } from '../src/edit/layout-patch.js';
import { computeEdgeAttrEdit, computeAttrEdit, applyTextEdits } from '../src/edit/position-patch.js';

const SRC = [
  'flowchart "T" {',
  '  a [A]',
  '  b [B]',
  '  c [C]',
  '  a -> b',
  '  b -> c: "go"',
  '}',
].join('\n');

const positions = { a: { x: 0, y: 0 }, b: { x: 0, y: 100 }, c: { x: 0, y: 200 } };
const edges = [
  { id: 'e1', sourceId: 'a', targetId: 'b', route: [{ x: 70, y: 60 }, { x: 70, y: 70 }, { x: 90, y: 70 }, { x: 90, y: 100 }] },
  { id: 'e2', sourceId: 'b', targetId: 'c', route: [{ x: 70, y: 160 }, { x: 70, y: 180 }, { x: 70.4, y: 200 }] },
];

describe('computeLayoutGestureEdits', () => {
  it('moving a node pins every node and freezes only the edges it does not touch', () => {
    const out = applyTextEdits(SRC, computeLayoutGestureEdits(SRC, { positions, edges, moved: { c: { x: 300, y: 200 } } }));
    expect(out).toContain('a [A] { x: 0, y: 0 }');
    expect(out).toContain('b [B] { x: 0, y: 100 }');
    expect(out).toContain('c [C] { x: 300, y: 200 }');
    expect(out).toContain('a -> b { via: [70, 70, 90, 70] }');   // untouched edge frozen (bends only)
    expect(out).toMatch(/b -> c: "go"\s*\n/);                        // incident edge left to re-route
  });

  it('a moved node drops the via of its edges so they re-route', () => {
    const pinned = SRC.replace('b -> c: "go"', 'b -> c: "go" { via: [1, 2, 3, 4] }');
    const out = applyTextEdits(pinned, computeLayoutGestureEdits(pinned, { positions, edges, moved: { b: { x: 9, y: 9 } } }));
    expect(out).not.toContain('via: [1, 2, 3, 4]');
    expect(out).not.toMatch(/b -> c: "go" \{/);
  });

  it('moving an edge writes its new route and changes no node position', () => {
    const route = [{ x: 70, y: 60 }, { x: 70, y: 80 }, { x: 140, y: 80 }, { x: 140, y: 100 }];
    const out = applyTextEdits(SRC, computeLayoutGestureEdits(SRC, { positions, edges, edgeRoute: { id: 'e1', route } }));
    expect(out).toContain('a -> b { via: [70, 80, 140, 80] }');
    expect(out).toContain('b [B] { x: 0, y: 100 }');
  });

  it('declares implicit nodes so they can be pinned too', () => {
    const src = 'flowchart "T" {\n  a --> b\n}';
    const out = applyTextEdits(src, computeLayoutGestureEdits(src, {
      positions: { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } }, edges: [], moved: { a: { x: 10, y: 20 } },
    }));
    expect(out).toContain('a { x: 10, y: 20 }');
    expect(out).toContain('b { x: 3, y: 4 }');
  });

  it('a second identical gesture is a no-op', () => {
    const once = applyTextEdits(SRC, computeLayoutGestureEdits(SRC, { positions, edges }));
    expect(computeLayoutGestureEdits(once, { positions, edges })).toEqual([]);
  });
});

describe('computeAutoLayoutEdits', () => {
  it('strips every x/y and via, removing emptied blocks', () => {
    const frozen = applyTextEdits(SRC, computeLayoutGestureEdits(SRC, { positions, edges }));
    const out = applyTextEdits(frozen, computeAutoLayoutEdits(frozen, ['a', 'b', 'c'], edges));
    expect(out).toBe(SRC);
  });

  it('keeps unrelated attributes', () => {
    const src = 'flowchart "T" {\n  a [A] { fill: "#f00", x: 5, y: 6 }\n}';
    const out = applyTextEdits(src, computeAutoLayoutEdits(src, ['a'], []));
    expect(out).toContain('a [A] { fill: "#f00" }');
  });
});

describe('computeEdgeAttrEdit', () => {
  it('refuses chained edge lines (their block is shared by every link)', () => {
    expect(computeEdgeAttrEdit('a --> b --> c', 'a', 'b', { via: [1, 2, 3, 4] })).toBeUndefined();
  });
  it('does not touch a node declaration with the same id', () => {
    expect(computeAttrEdit('a -> b', 'a', { x: 1 })).toBeUndefined();
  });
});
