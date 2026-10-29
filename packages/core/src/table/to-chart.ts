// =============================================================================
// SelDiA — table IR → chart IR (engine-side conversion, P4)
// =============================================================================
// A `chart …` directive inside a table fence turns the table's resolved cells
// into an ordinary chart DiagramIR: one category node per body row, the label
// column as the category, each value column as a series. It is built here
// from the table model — never by a renderer re-reading the table SVG — and
// then laid out and rendered by the existing chart pipeline unchanged.
// =============================================================================

import type { DiagramIR, IRNode } from '../ir/types.js';
import type { DiagramType } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';
import { columnName, parseTableNumber, valueAt, type TableChartSpec, type TableModel } from './model.js';

/** Build the chart IR for `spec` over `model`. Merged cells contribute their
 *  anchor value to every row they cover; an empty or non-numeric value is 0. */
export function tableToChartIR(model: TableModel, spec: TableChartSpec, title?: string): DiagramIR {
  const seriesNames = spec.y.map((c) => columnName(model, c).trim() || `Column ${c + 1}`);
  const nodes: IRNode[] = [];
  for (let r = 1; r < model.rows; r++) {
    const category = valueAt(model, r, spec.x).trim() || `Row ${r}`;
    const series = spec.y.map((c, i) => ({ name: seriesNames[i], value: parseTableNumber(valueAt(model, r, c)) ?? 0 }));
    nodes.push({
      id: `row-${r}`,
      label: `${category}\n${series.map((s) => `${s.name}: ${s.value}`).join('  ')}`,
      shape: ShapeType.RECTANGLE,
      position: { x: 0, y: 0 },
      size: { width: 0, height: 0 },
      style: {}, ports: [], classList: [], collapsed: false,
      // Structured copy of the label: series named "2024" or "Q1 (est.)"
      // don't survive the label vocabulary's name regex.
      data: { chart: { category, series } },
    } as IRNode);
  }
  return {
    id: 'table-chart', type: `chart-${spec.kind}` as DiagramType, title: title ?? 'Chart',
    nodes, edges: [], groups: [], layers: [], metadata: { fromTable: true },
  };
}
