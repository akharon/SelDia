// =============================================================================
// SelDiA — layout quality metrics: unit tests + corpus regression gate
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as core from '../src/index.js';
// @ts-expect-error plain .mjs shared with scripts/layout-metrics.mjs
import { measureCorpus } from '../../../scripts/layout-metrics-lib.mjs';
import { measureLayout } from '../src/layout/metrics.js';
import { DiagramType, EdgeRouting, type DiagramIR, type IRNode, type IREdge, type IRGroup } from '../src/ir/types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(HERE, 'fixtures', 'layout-baseline.json');
const EXAMPLES = path.join(HERE, '..', '..', '..', 'docs', 'examples');

function node(id: string, x: number, y: number, w = 100, h = 60): IRNode {
  return {
    id, label: id, shape: 'rectangle' as any, position: { x, y }, size: { width: w, height: h },
    style: {}, ports: [], classList: [], collapsed: false, data: {},
  } as IRNode;
}
function edge(id: string, s: string, t: string, wps: Array<[number, number]>): IREdge {
  return {
    id, sourceId: s, targetId: t, style: {}, routing: EdgeRouting.STRAIGHT,
    bidirectional: false, classList: [], data: {}, waypoints: wps.map(([x, y]) => ({ x, y })),
  } as IREdge;
}
function ir(nodes: IRNode[], edges: IREdge[], groups: IRGroup[] = []): DiagramIR {
  return { id: 't', type: DiagramType.FLOWCHART, nodes, edges, groups, layers: [], metadata: {} } as DiagramIR;
}
function group(id: string, x: number, y: number, w: number, h: number, kids: string[]): IRGroup {
  return { id, label: id, position: { x, y }, size: { width: w, height: h }, style: {}, childNodeIds: kids, childGroupIds: [] } as IRGroup;
}

describe('label nudge', () => {
  it('slides a label off a node sitting on its edge midpoint', () => {
    const nodes = [node('a', 0, 0), node('b', 700, 0), node('mid', 330, -10, 80, 80)];
    const e = { ...edge('e', 'a', 'b', [[100, 30], [700, 30]]), label: 'hello' } as IREdge;
    const m = measureLayout(ir(nodes, [e]));
    expect(m.labelOverlaps).toBe(0);
  });
});

describe('measureLayout units', () => {
  it('counts an X crossing once', () => {
    const nodes = [node('a', 0, 0), node('b', 300, 300), node('c', 300, 0), node('d', 0, 300)];
    const m = measureLayout(ir(nodes, [edge('e1', 'a', 'b', [[50, 30], [350, 330]]), edge('e2', 'c', 'd', [[350, 30], [50, 330]])]));
    expect(m.crossings).toBe(1);
  });
  it('ignores segments sharing an endpoint node', () => {
    const nodes = [node('a', 0, 0), node('b', 300, 300), node('c', 300, 0)];
    const m = measureLayout(ir(nodes, [edge('e1', 'a', 'b', [[50, 30], [350, 330]]), edge('e2', 'a', 'c', [[50, 30], [350, 30]])]));
    expect(m.crossings).toBe(0);
  });
  it('flags an edge through a third node, not a clear one', () => {
    const nodes = [node('a', 0, 0), node('m', 200, 0), node('b', 400, 0)];
    expect(measureLayout(ir(nodes, [edge('e', 'a', 'b', [[50, 30], [450, 30]])])).edgeNodeHits).toBe(1);
    const clear = [node('a', 0, 0), node('m', 200, 200), node('b', 400, 0)];
    expect(measureLayout(ir(clear, [edge('e', 'a', 'b', [[50, 30], [450, 30]])])).edgeNodeHits).toBe(0);
  });
  it('counts collinear overlap of different edges', () => {
    const nodes = [node('a', 0, 0), node('b', 400, 0), node('c', 400, 200), node('d', 0, 200)];
    const m = measureLayout(ir(nodes, [edge('e1', 'a', 'b', [[50, 30], [450, 30]]), edge('e2', 'd', 'c', [[50, 30], [300, 30]])]));
    expect(m.edgeOverlaps).toBe(1);
  });
  it('counts a segment hugging a node border', () => {
    const nodes = [node('a', 0, 0), node('h', 200, 100), node('b', 500, 0)];
    const hug = measureLayout(ir(nodes, [edge('e', 'a', 'b', [[100, 102], [500, 102]])]));
    expect(hug.borderHugs).toBe(1);
    const far = measureLayout(ir(nodes, [edge('e', 'a', 'b', [[100, 60], [500, 60]])]));
    expect(far.borderHugs).toBe(0);
  });
  it('counts bends as interior waypoints', () => {
    const nodes = [node('a', 0, 0), node('b', 300, 300)];
    expect(measureLayout(ir(nodes, [edge('e', 'a', 'b', [[50, 30], [50, 330], [350, 330]])])).bends).toBe(1);
  });
  it('flags a non-member inside a group and a member outside it', () => {
    const nodes = [node('a', 0, 0), node('b', 20, 20, 40, 20), node('far', 900, 900)];
    const clean = measureLayout(ir([nodes[0], nodes[2]], [], [group('g', -10, -10, 200, 200, ['a', 'far'])]));
    expect(clean.groupViolations).toBe(1); // 'far' is a member outside
    const intruder = measureLayout(ir(nodes, [], [group('g', -10, -10, 200, 200, ['a'])]));
    expect(intruder.groupViolations).toBe(1); // b intrudes; far is outside and not a member (fine)
  });
  it('flags overlapping sibling groups', () => {
    const nodes = [node('a', 0, 0), node('b', 100, 0)];
    const m = measureLayout(ir(nodes, [], [group('g1', 0, 0, 150, 100, ['a']), group('g2', 100, 0, 150, 100, ['b'])]));
    expect(m.groupViolations).toBeGreaterThanOrEqual(1);
  });
  it('reports area and aspect ratio', () => {
    const m = measureLayout(ir([node('a', 0, 0, 100, 50), node('b', 200, 0, 100, 50)], []));
    expect(m.area).toBe(300 * 50);
    expect(m.aspectRatio).toBe(6);
  });
});

// ── Corpus regression gate ───────────────────────────────────────────────────
// Aggregated per diagram TYPE with tolerance, so an ELK/dagre version bump that
// jitters one diagram does not break CI, while a real regression still does.
const GATED = ['crossings', 'edgeOverlaps', 'borderHugs', 'nodeLabelHits', 'edgeNodeHits', 'labelOverlaps', 'groupViolations'] as const;
const allowed = (base: number) => base + Math.max(1, Math.ceil(base * 0.1));

function byType(diagrams: Record<string, any>) {
  const out: Record<string, Record<string, number>> = {};
  for (const d of Object.values(diagrams)) {
    if (d.error) continue;
    const t = (out[d.type] ??= Object.fromEntries(GATED.map((k) => [k, 0])));
    for (const k of GATED) t[k] += d[k];
  }
  return out;
}

describe('layout metrics corpus regression', () => {
  it('stays within baseline per diagram type', async () => {
    const current = await measureCorpus(core, EXAMPLES, 'defaults');
    if (process.env.UPDATE_LAYOUT_BASELINE === '1') {
      writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
      return;
    }
    const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
    expect(current.failed).toBeLessThanOrEqual(base.failed);
    const cur = byType(current.diagrams), ref = byType(base.diagrams);
    for (const [type, b] of Object.entries(ref)) {
      for (const k of GATED) {
        expect(cur[type]?.[k] ?? 0, `${type}.${k}`).toBeLessThanOrEqual(allowed(b[k]));
      }
    }
  }, 120_000);
});
