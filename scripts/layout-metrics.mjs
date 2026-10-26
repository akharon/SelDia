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

const core = await import(pathToFileURL(join(root, 'packages/core/dist/index.js')).href);
const result = await measureCorpus(core, join(root, 'docs/examples'), engine);
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');

const t = result.totals;
console.log(`engine=${engine} measured=${result.measured} failed=${result.failed} | crossings=${t.crossings} edgeOverlaps=${t.edgeOverlaps} borderHugs=${t.borderHugs} nodeLabelHits=${t.nodeLabelHits} edgeNodeHits=${t.edgeNodeHits} labelOverlaps=${t.labelOverlaps} groupViolations=${t.groupViolations} bends=${t.bends}`);
if (!flag('--quiet')) {
  console.log('\n| diagram | type | cross | ovl | hug | hits | labels | bends | group | gap | aspect |\n|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|');
  for (const [k, d] of Object.entries(result.diagrams)) {
    if (d.error) console.log(`| ${k} | ${d.lang} | error: ${d.error} |||||||`);
    else if (d.crossings || d.edgeOverlaps || d.borderHugs || d.edgeNodeHits || d.labelOverlaps || d.groupViolations)
      console.log(`| ${k} | ${d.type} | ${d.crossings} | ${d.edgeOverlaps} | ${d.borderHugs} | ${d.edgeNodeHits} | ${d.labelOverlaps} | ${d.bends} | ${d.groupViolations} | ${d.endpointGap} | ${d.aspectRatio} |`);
  }
  console.log('\n(only diagrams with a nonzero defect are listed; full data in ' + out + ')');
}
