// Shared corpus walker for layout metrics (used by scripts/layout-metrics.mjs
// and packages/core/test/layout-metrics.test.ts). `core` is any module exposing
// createEngine, fenceToSource, importMermaid, importPlantUml, measureLayout, tokenViolations,
// tokenHistogram, lowContrastText.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Every diagram fence in docs/examples/*.md, where `isDiagramLang(lang)` says which
 *  fence languages count (core fenceToSource decides, so the corpus and the CLI agree). */
export function extractFences(examplesDir, isDiagramLang) {
  const out = [];
  for (const f of readdirSync(examplesDir).filter((n) => n.endsWith('.md')).sort()) {
    const lines = readFileSync(join(examplesDir, f), 'utf8').split('\n');
    let lang = null, buf = [], idx = 0, fence = '';
    for (const line of lines) {
      if (lang === null) {
        const m = line.match(/^(\s*)(`{3,}|~{3,})\s*([\w-]*)/);
        if (m) { fence = m[2]; lang = m[3].toLowerCase(); buf = []; }
      } else if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, '') === '') {
        if (isDiagramLang(lang)) out.push({ key: `${f}#${++idx}`, lang, code: buf.join('\n') });
        lang = null;
      } else buf.push(line);
    }
  }
  return out;
}

const KEYS = ['crossings', 'edgeOverlaps', 'borderHugs', 'nodeLabelHits', 'edgeNodeHits', 'labelOverlaps', 'labelDetached', 'labelOnArrowhead', 'labelEdgeHits', 'parallelRunLength', 'bends', 'maxBendsPerEdge', 'excessBends', 'groupViolations', 'groupTitleHits', 'nodeTextOverflow', 'tokenViolations', 'lowContrastText'];

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
  const hist = new Map();
  for (const { key, lang, code } of extractFences(examplesDir, (l) => core.fenceToSource(l, '') !== null)) {
    try {
      let ir;
      const { kind, source } = core.fenceToSource(lang, code);
      if (kind === 'seldia' || kind === 'circuit' || kind === 'pcb') {
        const p = engine.parse(source); if (!p.ok) throw new Error('parse');
        const a = engine.analyze(p.value); if (!a.ok) throw new Error('analyze');
        const t = engine.transform(a.value); if (!t.ok) throw new Error('transform');
        ir = t.value;
      } else {
        const r = kind === 'mermaid' ? core.importMermaid(source) : core.importPlantUml(source);
        if (!r.ir) {
          // The importer declined the block with a diagnostic (G3: it degrades, it does not
          // error). That is `unsupported`: listed, not failed, not gated. No diagnostic is a bug.
          const why = r.diagnostics?.[0]?.message;
          if (!why) throw new Error('import');
          diagrams[key] = { lang, unsupported: String(why) };
          continue;
        }
        ir = r.ir;
      }
      const l = await engine.layoutAsync(ir); if (!l.ok) throw new Error('layout');
      const m = core.measureLayout(l.value.diagram);
      const r = engine.render(l.value); if (!r.ok) throw new Error('render');
      const tokenViolations = core.tokenViolations(r.value.svg);
      const lowContrastText = core.lowContrastText?.(r.value.svg) ?? 0;
      for (const [k, c] of core.tokenHistogram?.(r.value.svg) ?? []) hist.set(k, (hist.get(k) ?? 0) + c);
      diagrams[key] = { lang, type: ir.type, ...m, endpointGap: round(m.endpointGap), tokenViolations, lowContrastText };
    } catch (e) {
      diagrams[key] = { lang, error: String(e.message ?? e) };
    }
  }
  const totals = Object.fromEntries(KEYS.map((k) => [k, 0]));
  let measured = 0, failed = 0, unsupported = 0;
  for (const d of Object.values(diagrams)) {
    if (d.unsupported) { unsupported++; continue; }
    if (d.error) { failed++; continue; }
    measured++;
    for (const k of KEYS) totals[k] = k === 'maxBendsPerEdge' ? Math.max(totals[k], d[k] ?? 0) : totals[k] + (d[k] ?? 0);
  }
  const tokenHistogram = Object.fromEntries([...hist].sort((a, b) => b[1] - a[1]));
  return { engine: engineName, measured, failed, unsupported, totals, tokenHistogram, diagrams };
}
const round = (x) => Math.round(x * 100) / 100;
