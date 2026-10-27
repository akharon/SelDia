#!/usr/bin/env node
// Layout quality metrics over docs/examples fences.
//   node scripts/layout-metrics.mjs [--engine dagre|elk]  (default: shipped per-type defaults) [--quiet] [--out file]
// Needs the built core (npm run build / tsc in packages/core).
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { measureCorpus } from './layout-metrics-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const engine = val('--engine', 'defaults');
if (!['dagre', 'elk', 'defaults'].includes(engine)) { console.error('--engine must be dagre|elk (or omit)'); process.exit(2); }
const out = val('--out', join(root, 'docs/layout-metrics.json'));

const index = await import(pathToFileURL(join(root, 'packages/core/dist/index.js')).href);
// tokenViolations/tokenHistogram/lowContrastText are not re-exported from the core index; take them from the metrics module.
const metrics = await import(pathToFileURL(join(root, 'packages/core/dist/layout/metrics.js')).href);
const core = { ...index, tokenViolations: metrics.tokenViolations, tokenHistogram: metrics.tokenHistogram, lowContrastText: metrics.lowContrastText };
const result = await measureCorpus(core, join(root, 'docs/examples'), engine);
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');

const t = result.totals;
console.log(`engine=${engine} measured=${result.measured} failed=${result.failed} unsupported=${result.unsupported} | crossings=${t.crossings} edgeOverlaps=${t.edgeOverlaps} borderHugs=${t.borderHugs} nodeLabelHits=${t.nodeLabelHits} edgeNodeHits=${t.edgeNodeHits} labelOverlaps=${t.labelOverlaps} labelDetached=${t.labelDetached} labelOnArrowhead=${t.labelOnArrowhead} labelEdgeHits=${t.labelEdgeHits} groupTitleHits=${t.groupTitleHits} nodeTextOverflow=${t.nodeTextOverflow} parallelRunLength=${t.parallelRunLength} groupViolations=${t.groupViolations} bends=${t.bends} maxBendsPerEdge=${t.maxBendsPerEdge} excessBends=${t.excessBends} (record-only) tokenViolations=${t.tokenViolations} (not gated) lowContrastText=${t.lowContrastText} (gated, baseline 0)`);
// Importer-declined blocks (G3: degraded, not failed): listed separately, even under --quiet.
for (const [k, d] of Object.entries(result.diagrams)) if (d.unsupported) console.log(`unsupported ${k} (${d.lang}): ${d.unsupported}`);
// Token histogram: every off-token value with its count, worst first, so the fix is obvious.
for (const [k, c] of Object.entries(result.tokenHistogram ?? {})) console.log(`  ${k} ×${c}`);
if (!flag('--quiet')) {
  console.log('\n| diagram | type | cross | ovl | hug | hits | labels | detach | arrow | edgeHit | run | bends | group | gtitle | ovfl | tok | gap | aspect |\n|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|');
  for (const [k, d] of Object.entries(result.diagrams)) {
    if (d.error) console.log(`| ${k} | ${d.lang} | error: ${d.error} |||||||||||||||`);
    else if (d.crossings || d.edgeOverlaps || d.borderHugs || d.edgeNodeHits || d.labelOverlaps || d.labelDetached || d.labelOnArrowhead || d.labelEdgeHits || d.parallelRunLength || d.groupViolations || d.groupTitleHits || d.nodeTextOverflow || d.tokenViolations || d.lowContrastText)
      console.log(`| ${k} | ${d.type} | ${d.crossings} | ${d.edgeOverlaps} | ${d.borderHugs} | ${d.edgeNodeHits} | ${d.labelOverlaps} | ${d.labelDetached} | ${d.labelOnArrowhead} | ${d.labelEdgeHits} | ${d.parallelRunLength} | ${d.bends} | ${d.groupViolations} | ${d.groupTitleHits} | ${d.nodeTextOverflow} | ${d.tokenViolations} | ${d.endpointGap} | ${d.aspectRatio} |`);
  }
  console.log('\n(only diagrams with a nonzero defect are listed; full data in ' + out + ')');
}
