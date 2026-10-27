// =============================================================================
// SelDiA — label, run-length and token metrics: unit tests on tiny hand-built IR
// =============================================================================
import { describe, it, expect } from 'vitest';
import { measureLayout, tokenViolations, tokenHistogram, lowContrastText, lowContrastTextHits } from '../src/layout/metrics.js';
import { computeEdgeLabelPositions } from '../src/render/edge-label-placement.js';
import { DiagramType, EdgeRouting, type DiagramIR, type IRNode, type IREdge, type IRGroup } from '../src/ir/types.js';

function labelled(id: string, label: string, shape: string, x: number, y: number, w: number, h: number): IRNode {
  return { ...node(id, x, y, w, h), label, shape: shape as any } as IRNode;
}

function node(id: string, x: number, y: number, w = 100, h = 60): IRNode {
  return {
    id, label: id, shape: 'rectangle' as any, position: { x, y }, size: { width: w, height: h },
    style: {}, ports: [], classList: [], collapsed: false, data: {},
  } as IRNode;
}
function edge(id: string, s: string, t: string, wps: Array<[number, number]>, label?: string): IREdge {
  return {
    id, sourceId: s, targetId: t, style: {}, routing: EdgeRouting.STRAIGHT,
    bidirectional: false, classList: [], data: {}, label, waypoints: wps.map(([x, y]) => ({ x, y })),
  } as IREdge;
}
function ir(nodes: IRNode[], edges: IREdge[], groups: IRGroup[] = []): DiagramIR {
  return { id: 't', type: DiagramType.FLOWCHART, nodes, edges, groups, layers: [], metadata: {} } as DiagramIR;
}

/** Leaders the placement emits for these edges (what the renderer draws as dashed hairlines). */
function leaderCount(d: DiagramIR): number {
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const pos = computeEdgeLabelPositions(d.edges, byId, 0, d.groups);
  return d.edges.filter((e) => pos.get(e.id)?.leader).length;
}

describe('labelDetached', () => {
  it('counts a chip whose rect is more than 16px from its own edge, and equals the leader count', () => {
    // 10px between the two node borders: the chip cannot sit on the line.
    const d = ir([node('a', 0, 0), node('b', 110, 0)], [edge('e', 'a', 'b', [[50, 30], [160, 30]], 'hello world')]);
    const m = measureLayout(d);
    expect(m.labelDetached).toBe(1);
    expect(m.labelDetached).toBe(leaderCount(d));
  });
  it('does not count a label on a long straight edge', () => {
    const d = ir([node('a', 0, 0), node('b', 700, 0)], [edge('e', 'a', 'b', [[100, 30], [700, 30]], 'hello')]);
    expect(measureLayout(d).labelDetached).toBe(0);
    expect(leaderCount(d)).toBe(0);
  });
  it('matches the leader count on a mixed diagram', () => {
    const d = ir(
      [node('a', 0, 0), node('b', 110, 0), node('c', 0, 200), node('d', 700, 200)],
      [edge('short', 'a', 'b', [[50, 30], [160, 30]], 'hello world'), edge('long', 'c', 'd', [[100, 230], [700, 230]], 'a label')],
    );
    expect(measureLayout(d).labelDetached).toBe(leaderCount(d));
  });
});

describe('labelOnArrowhead', () => {
  it('does not count a mid-edge label as sitting on the target end', () => {
    const m = measureLayout(ir([node('a', 0, 0), node('b', 700, 0)], [edge('e', 'a', 'b', [[100, 30], [700, 30]], 'hello')]));
    expect(m.labelOnArrowhead).toBe(0);
  });
});

describe('labelEdgeHits', () => {
  const nodes = [node('a', 0, 0), node('b', 200, 0)];
  const e = edge('e', 'a', 'b', [[50, 30], [250, 30]], 'x');
  it('keeps a chip out of a group title band (placement sees the groups, as the renderer does)', () => {
    // Band covers y 0..30, right above the line at y=30 where a chip sits.
    const g = { id: 'g', label: 'g', position: { x: -20, y: 0 }, size: { width: 400, height: 120 }, style: {}, childNodeIds: ['a', 'b'], childGroupIds: [] } as IRGroup;
    expect(measureLayout(ir(nodes, [e], [g])).labelEdgeHits).toBe(0);
  });
  it('does not count a chip with no group band near it', () => {
    expect(measureLayout(ir(nodes, [e])).labelEdgeHits).toBe(0);
  });
});

describe('parallelRunLength', () => {
  const nodes = [node('a', 0, 0), node('b', 400, 0), node('c', 400, 200), node('d', 0, 200)];
  it('sums the px two different edges share on one line', () => {
    // Both run along y=30 between x=100 and x=300: about 200px of shared run.
    const m = measureLayout(ir(nodes, [edge('e1', 'a', 'b', [[50, 30], [450, 30]]), edge('e2', 'd', 'c', [[50, 30], [300, 30]])]));
    expect(m.parallelRunLength).toBeGreaterThanOrEqual(180);
    expect(m.parallelRunLength).toBeLessThanOrEqual(210);
  });
  it('ignores lines 4px apart (outside the 2px tolerance)', () => {
    const m = measureLayout(ir(nodes, [edge('e1', 'a', 'b', [[50, 30], [450, 30]]), edge('e2', 'd', 'c', [[50, 34], [300, 34]])]));
    expect(m.parallelRunLength).toBe(0);
  });
  it('ignores a segment against itself (same edge)', () => {
    const m = measureLayout(ir(nodes, [edge('e1', 'a', 'b', [[50, 30], [450, 30], [450, 30]])]));
    expect(m.parallelRunLength).toBe(0);
  });
});

describe('tokenViolations (SVG)', () => {
  it('counts off-token stroke widths and font sizes', () => {
    const svg = '<svg><rect stroke-width="1.5"/><text font-size="12"/><rect stroke-width="3"/><text font-size="13"/></svg>';
    expect(tokenViolations(svg)).toBe(2);
  });
  it('accepts every DS token value', () => {
    const svg = '<svg><rect stroke-width="1"/><rect stroke-width="1.75"/><rect stroke-width="4"/><text font-size="11"/><text font-size="15"/></svg>';
    expect(tokenViolations(svg)).toBe(0);
  });
  it('skips a subtree after a token-exempt comment', () => {
    const svg = '<svg><!-- token-exempt --><g><rect stroke-width="3"/></g><rect stroke-width="3"/></svg>';
    expect(tokenViolations(svg)).toBe(1);
  });
  it('skips an element with data-token-exempt', () => {
    const svg = '<svg><text data-token-exempt="1" font-size="13"/><text font-size="13"/></svg>';
    expect(tokenViolations(svg)).toBe(1);
  });
  it('skips rough.js path elements', () => {
    expect(tokenViolations('<svg><path d="M0 0" stroke-width="9"/></svg>')).toBe(0);
  });
});

describe('groupTitleHits', () => {
  const nodes = [node('a', 300, 60), node('b', 500, 60)];
  // Group at (0,0): its title text box sits at roughly x 6..20, y 2..26.
  const g = { id: 'g', label: 'Zone', position: { x: 0, y: 0 }, size: { width: 400, height: 200 }, style: {}, childNodeIds: [], childGroupIds: [] } as IRGroup;
  it('counts an edge segment crossing the group title text box', () => {
    const m = measureLayout(ir(nodes, [edge('e', 'a', 'b', [[-5, 12], [300, 12]])], [g]));
    expect(m.groupTitleHits).toBeGreaterThanOrEqual(1);
  });
  it('does not count a segment below the title box', () => {
    const m = measureLayout(ir(nodes, [edge('e', 'a', 'b', [[-5, 120], [300, 120]])], [g]));
    expect(m.groupTitleHits).toBe(0);
  });
  it('ignores untitled groups', () => {
    const untitled = { ...g, label: '' } as IRGroup;
    expect(measureLayout(ir(nodes, [edge('e', 'a', 'b', [[-5, 12], [300, 12]])], [untitled])).groupTitleHits).toBe(0);
  });
});

describe('nodeTextOverflow', () => {
  const long = 'Approve the very long request now';
  it('counts a diamond whose wrapped label has too many lines for its inscribed box', () => {
    const d = ir([labelled('d', long, 'diamond', 0, 0, 120, 80)], []);
    expect(measureLayout(d).nodeTextOverflow).toBe(1);
  });
  it('does not count a short label that fits the diamond', () => {
    expect(measureLayout(ir([labelled('d', 'Decide', 'diamond', 0, 0, 120, 80)], [])).nodeTextOverflow).toBe(0);
  });
  it('counts a hexagon the same way', () => {
    expect(measureLayout(ir([labelled('h', long, 'hexagon', 0, 0, 120, 80)], [])).nodeTextOverflow).toBe(1);
  });
  it('ignores rectangles, which have the full box', () => {
    expect(measureLayout(ir([labelled('r', long, 'rectangle', 0, 0, 120, 80)], [])).nodeTextOverflow).toBe(0);
  });
});

describe('tokenHistogram', () => {
  it('keys off-token values by attribute and value, and sums to tokenViolations', () => {
    const svg = '<svg><rect stroke-width="3"/><rect stroke-width="3"/><text font-size="13"/><rect stroke-width="2.0"/></svg>';
    const h = tokenHistogram(svg);
    expect(h.get('stroke-width=3')).toBe(2);
    expect(h.get('font-size=13')).toBe(1);
    expect(h.get('stroke-width=2')).toBe(1);
    expect(tokenViolations(svg)).toBe(4);
  });
});

describe('lowContrastText (SVG)', () => {
  const W = '<rect x="0" y="0" width="200" height="100" fill="#ffffff"/>';
  it('passes black text on white', () => {
    expect(lowContrastText(`<svg>${W}<text x="10" y="20" fill="#000000">A</text></svg>`)).toBe(0);
  });
  it('counts light grey #ccc text on white', () => {
    expect(lowContrastText(`<svg>${W}<text x="10" y="20" fill="#cccccc">A</text></svg>`)).toBe(1);
  });
  it('skips text on the canvas (no filled shape beneath)', () => {
    expect(lowContrastText('<svg><text x="10" y="20" fill="#cccccc">A</text></svg>')).toBe(0);
  });
  it('uses the smallest filled shape containing the anchor', () => {
    const svg = `<svg>${W}<rect x="0" y="0" width="50" height="50" fill="#000000"/><text x="10" y="20" fill="#ffffff">A</text></svg>`;
    expect(lowContrastText(svg)).toBe(0);
  });
  it('resolves an inherited group fill and currentColor', () => {
    expect(lowContrastText(`<svg><g fill="#ffffff">${W.replace('fill="#ffffff"', '')}<text x="10" y="20" fill="#cccccc">A</text></g></svg>`)).toBe(1);
    expect(lowContrastText(`<svg><g color="#cccccc">${W}<text x="10" y="20" fill="currentColor">A</text></g></svg>`)).toBe(1);
  });
  it('reads a path bbox from absolute coordinates', () => {
    const svg = '<svg><path d="M0 0 L200 0 L200 100 L0 100 Z" fill="#ffffff"/><text x="10" y="20" fill="#cccccc">A</text></svg>';
    expect(lowContrastText(svg)).toBe(1);
  });
  it('reads the anchor from a tspan when the text has none', () => {
    const svg = `<svg>${W}<text fill="#cccccc"><tspan x="10" y="20">A</tspan></text></svg>`;
    expect(lowContrastText(svg)).toBe(1);
  });
  it('passes dark text on a 0.15-opacity blue tint (composited over white)', () => {
    const svg = '<svg><rect x="0" y="0" width="200" height="100" fill="#0000ff" fill-opacity="0.15"/><text x="10" y="20" fill="#111111">A</text></svg>';
    expect(lowContrastText(svg)).toBe(0);
  });
  it('counts #ccc text on a 0.15-opacity blue tint', () => {
    const svg = '<svg><rect x="0" y="0" width="200" height="100" fill="#0000ff" fill-opacity="0.15"/><text x="10" y="20" fill="#cccccc">A</text></svg>';
    expect(lowContrastText(svg)).toBe(1);
  });
  it('applies group opacity and text opacity', () => {
    expect(lowContrastText(`<svg>${W}<text x="10" y="20" fill="#000000" opacity="0.5">A</text></svg>`)).toBe(1);
    expect(lowContrastText(`<svg><g opacity="0.15">${W.replace('fill="#ffffff"', 'fill="#0000ff"')}</g><text x="10" y="20" fill="#111111">A</text></svg>`)).toBe(0);
  });
  it('reports the composited colours and text content of each hit', () => {
    const svg = `<svg>${W}<text x="10" y="20" fill="#cccccc">Hello <tspan>world</tspan></text></svg>`;
    const [hit] = lowContrastTextHits(svg);
    expect(hit.text).toBe('Hello world');
    expect(hit.fg).toBe('#cccccc');
    expect(hit.bg).toBe('#ffffff');
  });
});

