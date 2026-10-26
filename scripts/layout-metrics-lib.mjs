// Shared corpus walker for layout metrics (used by scripts/layout-metrics.mjs
// and packages/core/test/layout-metrics.test.ts). `core` is any module exposing
// createEngine, importMermaid, importPlantUml, measureLayout.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LANGS = new Set(['seldia', 'mermaid', 'plantuml']);

/** Every ```seldia/mermaid/plantuml fence in docs/examples/*.md. */
export function extractFences(examplesDir) {
  const out = [];
  for (const f of readdirSync(examplesDir).filter((n) => n.endsWith('.md')).sort()) {
    const lines = readFileSync(join(examplesDir, f), 'utf8').split('\n');
    let lang = null, buf = [], idx = 0, fence = '';
    for (const line of lines) {
      if (lang === null) {
        const m = line.match(/^(\s*)(`{3,}|~{3,})\s*([\w-]*)/);
        if (m) { fence = m[2]; lang = m[3].toLowerCase(); buf = []; }
      } else if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, '') === '') {
        if (LANGS.has(lang)) out.push({ key: `${f}#${++idx}`, lang, code: buf.join('\n') });
        lang = null;
      } else buf.push(line);
    }
  }
  return out;
}

const KEYS = ['crossings', 'edgeOverlaps', 'borderHugs', 'nodeLabelHits', 'edgeNodeHits', 'labelOverlaps', 'bends', 'groupViolations'];

// engineName: 'dagre' | 'elk' forces that engine for every type (per-type map is
// overridden too); 'defaults' uses the shipped config (per-type map as-is).
export async function measureCorpus(core, examplesDir, engineName = 'defaults') {
  const config = {};
  if (engineName !== 'defaults') {
    const keys = Object.keys(core.createEngine({}).config.layoutEngineByType);
    config.defaultLayoutEngine = engineName;
    config.layoutEngineByType = Object.fromEntries(keys.map((k) => [k, engineName]));
  }
  const engine = core.createEngine({ config });
  const diagrams = {};
  for (const { key, lang, code } of extractFences(examplesDir)) {
    try {
      let ir;
      if (lang === 'seldia') {
        const p = engine.parse(code); if (!p.ok) throw new Error('parse');
        const a = engine.analyze(p.value); if (!a.ok) throw new Error('analyze');
        const t = engine.transform(a.value); if (!t.ok) throw new Error('transform');
        ir = t.value;
      } else {
        const r = lang === 'mermaid' ? core.importMermaid(code) : core.importPlantUml(code);
        if (!r.ir) throw new Error('import');
        ir = r.ir;
      }
      const l = await engine.layoutAsync(ir); if (!l.ok) throw new Error('layout');
      const m = core.measureLayout(l.value.diagram);
      diagrams[key] = { lang, type: ir.type, ...m, endpointGap: round(m.endpointGap) };
    } catch (e) {
      diagrams[key] = { lang, error: String(e.message ?? e) };
    }
  }
  const totals = Object.fromEntries(KEYS.map((k) => [k, 0]));
  let measured = 0, failed = 0;
  for (const d of Object.values(diagrams)) {
    if (d.error) { failed++; continue; }
    measured++;
    for (const k of KEYS) totals[k] += d[k];
  }
  return { engine: engineName, measured, failed, totals, diagrams };
}
const round = (x) => Math.round(x * 100) / 100;
