// =============================================================================
// SelDiA — diagram validator (SelDiA DSL, Mermaid, PlantUML, circuit, pcb)
// =============================================================================
// One entry point that answers "does this diagram compile, and what is wrong
// with it?" with line-accurate issues. Used by the VS Code Copilot tool
// (`seldia_validate`) so an agent can see the problems and fix them itself.
// Unlike engine.validate (parse + analyze only) this runs the whole pipeline
// through render, so e.g. a diagram type with no plugin is reported too.

import type { CoreEngine } from './engine.js';
import { DiagnosticSeverity } from './types/common.js';
import { fenceToSource, type FenceKind } from './import/fence.js';
import { importMermaid } from './import/mermaid.js';
import { importPlantUml } from './import/plantuml.js';
import { measureLayout } from './layout/metrics.js';
import { CHECK_KEYS, CHECK_HINTS } from './check.js';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  /** 1-based line in the validated text (the whole file for Markdown). */
  line: number;
  column?: number;
  severity: IssueSeverity;
  message: string;
  code?: string;
}

export interface DiagramValidation {
  /** Fence language as written (`seldia`, `mermaid`, `puml`, ...). */
  lang: string;
  kind: FenceKind;
  /** 1-based line of the diagram's first source line in the validated text. */
  startLine: number;
  /** Diagram type when it got far enough to know it. */
  type?: string;
  issues: ValidationIssue[];
}

export interface ValidateOptions {
  /** Also lay the diagram out and report readability defects as `info`. */
  layout?: boolean;
}

const SEV: Record<string, IssueSeverity> = {
  [DiagnosticSeverity.ERROR]: 'error',
  [DiagnosticSeverity.WARNING]: 'warning',
  [DiagnosticSeverity.INFO]: 'info',
  [DiagnosticSeverity.HINT]: 'info',
};

const msg = (e: unknown) => String((e as Error)?.message ?? e);

/** Validate one diagram's source. Lines in the result are relative to `code` (1 = its first line). */
export async function validateDiagram(
  engine: CoreEngine,
  lang: string,
  code: string,
  opts: ValidateOptions = {},
): Promise<DiagramValidation> {
  const fence = fenceToSource(lang, code);
  if (!fence) {
    return { lang, kind: 'seldia', startLine: 1, issues: [{ line: 1, severity: 'error', message: `Unsupported diagram language "${lang}". Use seldia, mermaid, plantuml, circuit or pcb.` }] };
  }
  const out: DiagramValidation = { lang, kind: fence.kind, startLine: 1, issues: [] };
  // circuit/pcb get a synthetic header line prepended by fenceToSource.
  const shift = fence.kind === 'circuit' || fence.kind === 'pcb' ? 1 : 0;
  const at = (line: number | undefined) => Math.max(1, (line ?? 1) - shift);
  const push = (i: ValidationIssue) => out.issues.push(i);

  let ir: any;
  try {
    if (fence.kind === 'mermaid' || fence.kind === 'plantuml') {
      const r = fence.kind === 'mermaid' ? importMermaid(fence.source) : importPlantUml(fence.source);
      ir = r.ir;
      // With an IR the diagnostics are statements the importer dropped (the
      // diagram still renders without them); without one the import failed.
      for (const d of r.diagnostics) push({ line: Math.max(1, d.line), severity: ir ? 'warning' : 'error', message: d.message });
      if (!ir) {
        if (!r.diagnostics.length) push({ line: 1, severity: 'error', message: `${fence.kind} import failed` });
        return out;
      }
    } else {
      const fail = (errs: any[], stage: string) => {
        for (const d of errs ?? []) push({ line: at(d.source?.startLine), column: d.source?.startColumn, severity: SEV[d.severity] ?? 'error', message: d.message, code: d.code });
        if (!errs?.length) push({ line: 1, severity: 'error', message: `${stage} failed` });
        return out;
      };
      const p: any = engine.parse(fence.source);
      if (!p.ok) return fail(p.errors, 'parse');
      out.type = String(p.value.type ?? '') || undefined;
      const a: any = engine.analyze(p.value);
      if (!a.ok) return fail(a.errors, 'analyze');
      for (const d of engine.validateSemantics(a.value)) {
        push({ line: at(d.line), column: d.column, severity: d.severity, message: d.nodeId ? `${d.message} (node "${d.nodeId}")` : d.message, code: d.code });
      }
      const t: any = engine.transform(a.value);
      if (!t.ok) return fail(t.errors, 'transform');
      ir = t.value;
    }
    out.type = String(ir.type);

    const l: any = await engine.layoutAsync(ir);
    if (!l.ok) {
      for (const d of l.errors ?? []) push({ line: 1, severity: 'error', message: `layout: ${d.message}` });
      if (!l.errors?.length) push({ line: 1, severity: 'error', message: 'layout failed' });
      return out;
    }
    const r: any = engine.render(l.value);
    if (!r.ok) {
      for (const d of r.errors ?? []) push({ line: 1, severity: 'error', message: `render: ${d.message}` });
      if (!r.errors?.length) push({ line: 1, severity: 'error', message: 'render failed' });
      return out;
    }
    if (opts.layout) {
      const m: any = measureLayout(l.value.diagram);
      for (const k of CHECK_KEYS) {
        if (m[k]) push({ line: 1, severity: 'info', code: k, message: `${m[k]} × ${k}: ${CHECK_HINTS[k]}` });
      }
    }
  } catch (e) {
    push({ line: 1, severity: 'error', message: msg(e) });
  }
  return out;
}

export interface MarkdownFence { lang: string; code: string; /** 1-based line of the first body line. */ startLine: number }

/** Diagram fences (seldia, mermaid, plantuml, circuit, pcb ...) of a Markdown document. */
export function extractDiagramFences(markdown: string): MarkdownFence[] {
  const out: MarkdownFence[] = [];
  const lines = markdown.split(/\r?\n/);
  let lang: string | null = null;
  let fence = '';
  let start = 0;
  let buf: string[] = [];
  lines.forEach((line, i) => {
    if (lang === null) {
      const m = line.match(/^\s*(`{3,}|~{3,})\s*([\w-]*)/);
      if (m) { fence = m[1]; lang = m[2].toLowerCase(); buf = []; start = i + 2; }
    } else if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, '') === '') {
      if (fenceToSource(lang, '') !== null) out.push({ lang, code: buf.join('\n'), startLine: start });
      lang = null;
    } else buf.push(line);
  });
  return out;
}

const EXT_LANG: Record<string, string> = {
  sld: 'seldia', seldia: 'seldia',
  mmd: 'mermaid', mermaid: 'mermaid',
  puml: 'plantuml', plantuml: 'plantuml', pu: 'plantuml', iuml: 'plantuml', wsd: 'plantuml',
  cir: 'circuit', spice: 'circuit', net: 'circuit',
  kicad_pcb: 'pcb',
};

/** Fence language for a whole-file diagram, by extension; `markdown` for .md; null otherwise. */
export function languageForPath(path: string): string | null {
  const ext = path.toLowerCase().match(/\.([\w]+)$/)?.[1] ?? '';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  return EXT_LANG[ext] ?? null;
}

/**
 * Validate a whole document: every diagram fence of a Markdown file, or the
 * file itself for a diagram file. `lang` is a fence language or `markdown`.
 * Issue lines are made absolute (relative to `text`).
 */
export async function validateDocument(
  engine: CoreEngine,
  text: string,
  lang: string,
  opts: ValidateOptions = {},
): Promise<DiagramValidation[]> {
  if (lang === 'markdown') {
    const res: DiagramValidation[] = [];
    for (const f of extractDiagramFences(text)) {
      const v = await validateDiagram(engine, f.lang, f.code, opts);
      v.startLine = f.startLine;
      for (const i of v.issues) i.line += f.startLine - 1;
      res.push(v);
    }
    return res;
  }
  return [await validateDiagram(engine, lang, text, opts)];
}

/** Compact, agent-friendly report: one line per issue, `file:line:col severity message`. */
export function formatValidationReport(results: DiagramValidation[], file = '<input>'): string {
  if (!results.length) return `${file}: no diagrams found.`;
  const errors = results.reduce((n, r) => n + r.issues.filter((i) => i.severity === 'error').length, 0);
  const warnings = results.reduce((n, r) => n + r.issues.filter((i) => i.severity === 'warning').length, 0);
  const lines = [`${file}: ${results.length} diagram(s), ${errors} error(s), ${warnings} warning(s).`];
  results.forEach((r, idx) => {
    const head = `#${idx + 1} ${r.lang}${r.type ? ` (${r.type})` : ''} at line ${r.startLine}`;
    if (!r.issues.length) { lines.push(`${head}: ok`); return; }
    lines.push(`${head}:`);
    for (const i of r.issues) {
      const loc = `${file}:${i.line}${i.column ? `:${i.column}` : ''}`;
      lines.push(`  ${loc} ${i.severity}${i.code ? ` [${i.code}]` : ''}: ${i.message}`);
    }
  });
  return lines.join('\n');
}
