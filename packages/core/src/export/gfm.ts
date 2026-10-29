// =============================================================================
// SelDiA — table IR → GitHub-flavoured Markdown table
// =============================================================================
// Lossy by construction (G4): GFM has no rowspan/colspan, so a merged cell's
// text stays in its anchor (top-left) position and every cell it covered is
// written empty. Alignment survives via the delimiter row; the title and any
// chart directive do not. Returns null for anything that isn't a table IR.
// =============================================================================

import type { DiagramIR } from '../ir/types.js';

const gfmCell = (t: string) => t.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

export function exportTableGfm(ir: DiagramIR): string | null {
  if ((ir.type as string) !== 'table') return null;
  const meta = (ir.metadata?.table ?? {}) as { rows?: number; cols?: number; align?: Array<string | null> };
  const rows = meta.rows ?? 0, cols = meta.cols ?? 0;
  if (!rows || !cols) return null;
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(''));
  for (const n of ir.nodes) {
    const d = n.data as any;
    if (d?.role !== 'table-cell' || d.row >= rows || d.col >= cols) continue;
    grid[d.row][d.col] = gfmCell(n.label);
  }
  const delim = Array.from({ length: cols }, (_, c) => {
    const a = meta.align?.[c];
    return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---';
  });
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(grid[0]), line(delim), ...grid.slice(1).map(line)].join('\n') + '\n';
}
