// =============================================================================
// SelDiA CLI — Repository Scanning
// =============================================================================
// Finds renderable diagram sources in a directory tree: standalone `.sld`
// files and ```seldia fenced blocks inside `.md` files. This is the plain-Node
// counterpart to packages/vscode-ext/src/markdown/detector.ts's BlockDetector
// — same fence vocabulary (```seldia and ```seldia-<type>), but walking the
// filesystem instead of a live vscode.TextDocument, since the GitHub Action
// (and this `render` command) has no editor to hook into.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, extname } from 'path';

export interface FoundDiagram {
  /** Absolute path to the source file (.sld, or the .md file containing the fence). */
  file: string;
  /** DSL/source text to compile. */
  source: string;
  /** 'sld' for a standalone file, 'md-fence' for a fenced block inside Markdown. */
  kind: 'sld' | 'md-fence';
  /** 1-based line number of the fence/file start, for diagnostics. */
  line: number;
  /** Index of this block within its file (0 for .sld files, 0..N for md fences). */
  index: number;
  /** Suggested output basename (without extension), unique within the file. */
  slug: string;
}

const DEFAULT_IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.svelte-kit']);

const SELDIA_FENCE = /^```(seldia|seldia-(\w+))\s*$/;
const CLOSE_FENCE = /^```\s*$/;

/** Extract ```seldia / ```seldia-<type> fenced blocks from Markdown source. */
export function findFencesInMarkdown(source: string): Array<{ source: string; line: number; index: number }> {
  const lines = source.split('\n');
  const blocks: Array<{ source: string; line: number; index: number }> = [];
  let i = 0;
  let index = 0;
  while (i < lines.length) {
    const match = lines[i].match(SELDIA_FENCE);
    if (match) {
      const startLine = i + 1; // 1-based
      const body: string[] = [];
      i++;
      while (i < lines.length && !CLOSE_FENCE.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      blocks.push({ source: body.join('\n'), line: startLine, index });
      index++;
      i++; // consume closing fence
      continue;
    }
    i++;
  }
  return blocks;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (DEFAULT_IGNORE.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (st.isFile()) {
      out.push(full);
    }
  }
}

/**
 * Recursively find `.sld` files and ```seldia fenced blocks in `.md` files
 * under `root`. `extraExts` allows callers (e.g. --ext .seldia) to widen the
 * standalone-file match beyond `.sld`.
 */
export function scanRepo(root: string, extraExts: string[] = []): FoundDiagram[] {
  const files: string[] = [];
  walk(root, files);

  const sldExts = new Set(['.sld', '.seldia', ...extraExts]);
  const results: FoundDiagram[] = [];

  for (const file of files) {
    const ext = extname(file);
    if (sldExts.has(ext)) {
      const source = readFileSync(file, 'utf-8');
      results.push({ file, source, kind: 'sld', line: 1, index: 0, slug: baseSlug(root, file) });
    } else if (ext === '.md' || ext === '.markdown') {
      const text = readFileSync(file, 'utf-8');
      const fences = findFencesInMarkdown(text);
      for (const fence of fences) {
        results.push({
          file,
          source: fence.source,
          kind: 'md-fence',
          line: fence.line,
          index: fence.index,
          slug: `${baseSlug(root, file)}${fences.length > 1 ? `-${fence.index}` : ''}`,
        });
      }
    }
  }

  return results;
}

function baseSlug(root: string, file: string): string {
  const rel = relative(root, file).replace(/\.(sld|seldia|md|markdown)$/i, '');
  return rel.split(/[\\/]/).join('__');
}
