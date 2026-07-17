// =============================================================================
// SelDiA MCP — Diagram loading
// =============================================================================
// Thin wrapper around @seldia/core's engine pipeline (parse -> analyze ->
// transform) plus the Mermaid importer, so every MCP tool works against the
// same DiagramIR regardless of source format. This intentionally does not
// cache diagrams across tool calls: each tool re-reads the file from disk,
// which keeps the server stateless and safe to use alongside a human editing
// the same file in an editor.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import {
  createEngine,
  importMermaid,
  isMermaidSource,
  DiagnosticSeverity,
  DiagramType,
  type CoreEngine,
  type DiagramIR,
  type Diagnostic,
} from '@seldia/core';

export interface LoadedDiagram {
  ir: DiagramIR;
  diagnostics: Diagnostic[];
  /** True when the file's diagnostics contain no errors (warnings are OK). */
  ok: boolean;
  source: string;
  format: 'sld' | 'mermaid';
}

const MERMAID_EXTENSIONS = new Set(['.mmd', '.mermaid']);

export function isMermaidFile(path: string): boolean {
  return MERMAID_EXTENSIONS.has(extname(path).toLowerCase());
}

let sharedEngine: CoreEngine | undefined;
export function getEngine(): CoreEngine {
  if (!sharedEngine) sharedEngine = createEngine();
  return sharedEngine;
}

/** Load a .sld or Mermaid (.mmd/.mermaid, or a .sld/.md whose content sniffs
 *  as Mermaid) file into IR. Reuses the engine's own parse/analyze/transform
 *  pipeline — this file adds no parsing logic of its own. */
export function loadDiagram(path: string): LoadedDiagram {
  const source = readFileSync(path, 'utf-8');
  const engine = getEngine();

  if (isMermaidFile(path) || isMermaidSource(source)) {
    const result = importMermaid(source);
    // MermaidImportDiagnostic carries no severity: the importer reports a
    // diagnostic for any unsupported/malformed block but keeps rendering
    // everything else, so treat these as warnings unless the whole import
    // failed to produce an IR at all (see import/mermaid.ts module doc).
    const diagnostics: Diagnostic[] = (result.diagnostics || []).map((d) => ({
      severity: result.ir ? DiagnosticSeverity.WARNING : DiagnosticSeverity.ERROR,
      message: d.message,
      source: { file: path, startLine: d.line ?? 0, startColumn: 0, endLine: d.line ?? 0, endColumn: 0, offset: 0 },
      code: 'MERMAID_IMPORT',
    }));
    if (!result.ir) {
      return { ir: emptyIR(), diagnostics, ok: false, source, format: 'mermaid' };
    }
    return { ir: result.ir, diagnostics, ok: true, source, format: 'mermaid' };
  }

  const parsed = engine.parse(source, path);
  if (!parsed.ok) return { ir: emptyIR(), diagnostics: parsed.errors, ok: false, source, format: 'sld' };

  const analyzed = engine.analyze(parsed.value);
  if (!analyzed.ok) return { ir: emptyIR(), diagnostics: analyzed.errors, ok: false, source, format: 'sld' };

  const transformed = engine.transform(analyzed.value);
  if (!transformed.ok) return { ir: emptyIR(), diagnostics: transformed.errors, ok: false, source, format: 'sld' };

  return { ir: transformed.value, diagnostics: [], ok: true, source, format: 'sld' };
}

/** Diagnostics-only pass, without paying for transform — mirrors
 *  `engine.validate()` but also covers the Mermaid import path. */
export function validateDiagram(path: string): Diagnostic[] {
  const source = readFileSync(path, 'utf-8');
  if (isMermaidFile(path) || isMermaidSource(source)) {
    return loadDiagram(path).diagnostics;
  }
  return getEngine().validate(source, path);
}

function emptyIR(): DiagramIR {
  return {
    id: 'empty',
    type: DiagramType.FLOWCHART,
    nodes: [],
    edges: [],
    groups: [],
    layers: [],
    metadata: {},
  };
}
