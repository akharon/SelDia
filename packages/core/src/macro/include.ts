// =============================================================================
// SelDiA — Macro/Include System
// =============================================================================
// A minimal `include "other-file.sld"` preprocessor directive that lets a
// diagram source pull in fragments from another file (shared node
// definitions, a repeated sub-pattern) before parsing. Deliberately just
// literal text substitution — a C-style #include, not a templating or
// parameterized-macro system — per the conservative scope this was asked to
// stay within.
//
// This runs entirely on raw source text, BEFORE parseDSL() ever sees it, so
// it never touches the tokenizer/parser grammar (parser/parser.ts is
// off-limits — a concurrent change is fixing that file). Any diagram-body
// syntax the included fragment produces still has to be valid SelDiA DSL;
// this module has no opinion about what's inside an included file beyond
// finding and stripping its own include directives recursively.
//
// Directive syntax: a line (leading whitespace allowed) of the form
//   include "path/to/fragment.sld"
// or
//   include 'path/to/fragment.sld'
// The path is resolved relative to the file containing the directive. The
// directive line is replaced in-place by the included file's full text
// (after that file's own includes have themselves been expanded), so
// fragments can nest normally inside a diagram body:
//
//   flowchart "Checkout" {
//     include "fragments/common-nodes.sld"
//     a --> b
//   }
// =============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const INCLUDE_RE = /^([ \t]*)include\s+["']([^"']+)["']\s*$/;

export interface IncludeExpansionResult {
  /** Final source text with every include directive replaced by the
   *  referenced file's contents. */
  source: string;
  /** Absolute paths of every file that was included (post-resolution),
   *  in inclusion order — useful for a caller that wants to watch them for
   *  changes, or report what was pulled in. */
  includedFiles: string[];
  /** Non-fatal problems (missing file, cycle detected) — expansion still
   *  produces *something* (the directive line is dropped) rather than
   *  throwing, matching this codebase's "never crash the pipeline on bad
   *  input" convention (see export/mermaid.ts's own doc comment). */
  diagnostics: string[];
}

/**
 * Expand `include "file.sld"` directives in `source`, which was read from
 * `filePath` (used to resolve relative include paths; pass the diagram's own
 * path, or omit if `source` has no relative includes to resolve).
 */
export function expandIncludes(source: string, filePath?: string): IncludeExpansionResult {
  const includedFiles: string[] = [];
  const diagnostics: string[] = [];
  const baseDir = filePath ? dirname(resolve(filePath)) : process.cwd();

  const expand = (text: string, currentDir: string, stack: string[]): string => {
    const lines = text.split('\n');
    const out: string[] = [];
    for (const line of lines) {
      const m = INCLUDE_RE.exec(line);
      if (!m) { out.push(line); continue; }
      const [, indent, rawPath] = m;
      const resolved = resolve(currentDir, rawPath);
      if (stack.includes(resolved)) {
        diagnostics.push(`Circular include detected: ${rawPath} (from ${stack[stack.length - 1] || '<root>'})`);
        continue;
      }
      if (!existsSync(resolved)) {
        diagnostics.push(`Include not found: "${rawPath}" (resolved to ${resolved})`);
        continue;
      }
      let fragment: string;
      try {
        fragment = readFileSync(resolved, 'utf-8');
      } catch (err: any) {
        diagnostics.push(`Failed to read include "${rawPath}": ${err.message}`);
        continue;
      }
      includedFiles.push(resolved);
      const expanded = expand(fragment, dirname(resolved), [...stack, resolved]);
      // Preserve the directive line's indentation on every line of the
      // fragment so an include nested inside a `{ }` body stays readable
      // and doesn't dedent relative to its surrounding block.
      const indented = expanded.split('\n').map((l) => (l.length ? indent + l : l)).join('\n');
      out.push(indented);
    }
    return out.join('\n');
  };

  const expanded = expand(source, baseDir, filePath ? [resolve(filePath)] : []);
  return { source: expanded, includedFiles, diagnostics };
}
