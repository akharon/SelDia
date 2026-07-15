// =============================================================================
// SelDiA — Chart scale / axis / legend tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import type { IRNode } from '../src/ir/types.js';
import {
  chartScale, chartPlot, renderChartAxes,
  chartLegendHeight, chartLegendMinWidth, renderChartLegend,
} from '../src/render/custom-renderers.js';

function cat(id: string, label: string, x = 0): IRNode {
  return {
    id, label, shape: 'rectangle' as any,
    position: { x, y: 40 }, size: { width: 120, height: 320 }, style: {},
    ports: [], classList: [], collapsed: false, data: {},
  };
}

describe('chartScale', () => {
  it('rounds the axis top up to a whole number of nice steps', () => {
    // Data peaks at 175 — the axis must not stop there, it stops at 200.
    const s = chartScale([cat('a', 'Wk1\nDesktop: 120  Mobile: 90'), cat('b', 'Wk2\nDesktop: 155  Mobile: 175')]);
    expect(s.max).toBe(200);
    expect(s.ticks).toEqual([0, 50, 100, 150, 200]);
  });

  it('uses 1/2/5-style steps across magnitudes', () => {
    expect(chartScale([cat('a', 'A\nx: 8')]).ticks).toEqual([0, 2, 4, 6, 8]);
    expect(chartScale([cat('a', 'A\nx: 4300')]).max).toBe(5000);
  });

  it('always starts at zero so bar heights stay proportional', () => {
    expect(chartScale([cat('a', 'A\nx: 900'), cat('b', 'B\nx: 950')]).ticks[0]).toBe(0);
  });

  it('survives a chart with no numbers in it', () => {
    const s = chartScale([cat('a', 'Just a label')]);
    expect(s.max).toBeGreaterThan(0);
    expect(s.ticks.length).toBeGreaterThan(1);
  });
});

describe('renderChartAxes', () => {
  const nodes = [cat('a', 'Wk1\nDesktop: 120', 80), cat('b', 'Wk2\nDesktop: 200', 220)];

  it('draws both axes and one labelled gridline per tick', () => {
    const scale = chartScale(nodes);
    const svg = renderChartAxes(nodes, 20, scale);
    for (const t of scale.ticks) expect(svg).toContain(`>${t}<`);
    // A gridline for every tick except zero, which the x axis already is.
    expect(svg.match(/stroke-dasharray="3,4"/g) ?? []).toHaveLength(scale.ticks.length - 1);
  });

  it('spans the axes across the whole plot, not per category', () => {
    const plot = chartPlot(nodes, 20)!;
    const svg = renderChartAxes(nodes, 20, chartScale(nodes));
    expect(svg).toContain(`x2="${plot.right}"`);
    expect(plot.bottom).toBeGreaterThan(plot.top);
  });
});

describe('chart legend', () => {
  const many = ['Desktop Web Client', 'Mobile Native App', 'Partner Integrations', 'Internal Tooling', 'Legacy Terminals'];

  it('is omitted when there is nothing to disambiguate', () => {
    expect(chartLegendHeight(['Only'], 400)).toBe(0);
    expect(renderChartLegend(['Only'], 400, 0)).toBe('');
  });

  // The reported bug: a single centred row ran off both edges of the canvas.
  it('wraps onto more rows in a narrow canvas, and reports the taller strip', () => {
    const narrow = chartLegendHeight(many, 300);
    const wide = chartLegendHeight(many, 2000);
    expect(narrow).toBeGreaterThan(wide);
  });

  it('keeps every entry inside the canvas once wrapped', () => {
    const width = 456;
    const svg = renderChartLegend(many, width, 0);
    const xs = [...svg.matchAll(/<rect x="([-\d.]+)"/g)].map((m) => parseFloat(m[1]));
    expect(xs.length).toBe(many.length);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(width);
    }
  });

  it('asks for a canvas at least as wide as its widest entry', () => {
    const min = chartLegendMinWidth(many);
    expect(min).toBeGreaterThan(0);
    // At that width every entry fits on a row of its own — nothing is clipped.
    const svg = renderChartLegend(many, min, 0);
    const xs = [...svg.matchAll(/<rect x="([-\d.]+)"/g)].map((m) => parseFloat(m[1]));
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0);
  });
});
