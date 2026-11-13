import type { CoreEngine } from './engine.js';
import { fenceToSource } from './import/fence.js';
import { importMermaid } from './import/mermaid.js';
import { importPlantUml } from './import/plantuml.js';
import { measureLayout } from './layout/metrics.js';

/** Layout defects a reader would notice, in report order. */
export const CHECK_KEYS = ['crossings', 'edgeOverlaps', 'edgeNodeHits', 'labelOverlaps', 'labelDetached', 'labelOnArrowhead', 'labelEdgeHits', 'groupViolations', 'nodeLabelHits'] as const;

export interface CheckResult {
  type: string;
  problems: Record<string, number>;
  total: number;
  error?: string;
}

/** What an author (human or agent) should change to reduce each defect. */
export const CHECK_HINTS: Record<string, string> = {
  crossings: 'edges cross: reorder node declarations, or set a different `direction`',
  edgeOverlaps: 'edges run on top of each other: reorder declarations or add an intermediate node',
  edgeNodeHits: 'an edge passes through a node: reorder declarations or change `direction`',
  labelOverlaps: 'edge labels collide with nodes or each other: shorten labels',
  labelDetached: 'edge labels sit far from their edge: shorten labels or reduce edge length',
  labelOnArrowhead: 'a label covers an arrowhead: shorten labels',
  labelEdgeHits: 'a label overlaps another edge: shorten labels or reorder declarations',
  groupViolations: 'group membership/overlap problem: keep each node in one group and avoid edges that force nodes out of their group',
  nodeLabelHits: 'an edge crosses a node label: reorder declarations or change `direction`',
};

/** Compile a diagram, lay it out as it renders, and count readability defects. */
export async function checkDiagramQuality(engine: CoreEngine, lang: string, code: string): Promise<CheckResult> {
  try {
    const fence = fenceToSource(lang, code);
    if (!fence) throw new Error(`unsupported fence language: ${lang}`);
    let ir: any;
    if (fence.kind === 'mermaid') ir = importMermaid(fence.source).ir;
    else if (fence.kind === 'plantuml') ir = importPlantUml(fence.source).ir;
    else {
      const p: any = engine.parse(fence.source); if (!p.ok) throw new Error('parse failed');
      const a: any = engine.analyze(p.value); if (!a.ok) throw new Error('analyze failed');
      const t: any = engine.transform(a.value); if (!t.ok) throw new Error('transform failed');
      ir = t.value;
    }
    if (!ir) throw new Error('import failed');
    const l: any = await engine.layoutAsync(ir); if (!l.ok) throw new Error('layout failed');
    const m: any = measureLayout(l.value.diagram);
    const problems: Record<string, number> = {};
    let total = 0;
    for (const k of CHECK_KEYS) if (m[k]) { problems[k] = m[k]; total += m[k]; }
    return { type: String(ir.type), problems, total };
  } catch (e: any) {
    return { type: lang, problems: {}, total: 0, error: String(e?.message ?? e) };
  }
}

/** Concise text report with one fix hint per non-zero defect. */
export function formatCheckReport(r: CheckResult): string {
  if (r.error) return `Error: ${r.error}`;
  if (r.total === 0) return `${r.type}: clean (no layout defects).`;
  const lines = [`${r.type}: ${r.total} layout defect(s).`];
  for (const [k, v] of Object.entries(r.problems)) lines.push(`- ${k}=${v}: ${CHECK_HINTS[k] ?? ''}`);
  return lines.join('\n');
}
