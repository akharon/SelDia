// =============================================================================
// SelDiA — Gantt chart tests
// =============================================================================
// Guards the three ways a Gantt chart used to collapse into a narrow sliver:
// tasks nested in `section` blocks never reaching the IR, undated task labels
// being misread as dates, and the axis labelling its origin "Jan 0".
import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/index.js';
import type { DiagramIR } from '../src/ir/types.js';
import { ganttDayLabel } from '../src/render/custom-layout.js';

const engine = createEngine();

function irOf(src: string): DiagramIR {
  const parsed = engine.parse(src);
  expect(parsed.ok, parsed.ok ? '' : JSON.stringify(parsed.errors).slice(0, 300)).toBe(true);
  if (!parsed.ok) throw new Error('unreachable');
  const analyzed = engine.analyze(parsed.value);
  if (!analyzed.ok) throw new Error('analyze failed');
  const ir = engine.transform(analyzed.value);
  if (!ir.ok) throw new Error('transform failed');
  return ir.value;
}

async function layoutOf(src: string) {
  const r = await engine.layoutAsync(irOf(src));
  if (!r.ok) throw new Error('layout failed');
  return r.value;
}

const SECTIONED = `diagram gantt "Project Plan" {
  section "Planning" {
    req: [Requirements: Jan 6-17]
    design: [Architecture: Jan 13-24]
  }
  section "Development" {
    sprint1: [Sprint 1: Jan 27 - Feb 7]
  }
  section "Release" {
    mvp: (MVP: Feb 24)
  }
  req --> design
  design --> sprint1
  sprint1 --> mvp
}`;

describe('gantt sections', () => {
  it('lifts tasks declared inside section blocks into the IR', () => {
    const ir = irOf(SECTIONED);
    expect(ir.nodes.map((n) => n.id).sort()).toEqual(['design', 'mvp', 'req', 'sprint1']);
  });

  it('tags each task with the section it came from', () => {
    const ir = irOf(SECTIONED);
    const byId = new Map(ir.nodes.map((n) => [n.id, n]));
    expect((byId.get('req')!.data as any).sectionLabel).toBe('Planning');
    expect((byId.get('sprint1')!.data as any).sectionLabel).toBe('Development');
  });

  it('lays the sectioned plan out at full chart width, not a sliver', async () => {
    const { bounds } = await layoutOf(SECTIONED);
    // Four dated tasks spanning ~7 weeks: comfortably wider than the 200px
    // label gutter. The pre-fix chart had zero bars and came out ~56px.
    expect(bounds.width).toBeGreaterThan(600);
  });

  it('still handles a flat, section-free chart', () => {
    const ir = irOf(`diagram gantt "Flat" {
      a: [Alpha: Jan 6-17]
      b: [Beta: Jan 20-24]
      a --> b
    }`);
    expect(ir.nodes).toHaveLength(2);
  });
});

describe('gantt date parsing', () => {
  it('does not read an undated task label as a date', async () => {
    // "Sprint 1" matches the date regex (word + number) but "Sprint" is not a
    // month; it used to land 29 days before January and render as a milestone.
    const { diagram } = await layoutOf(`diagram gantt "Undated" {
      a: [Requirements]
      b: [Sprint 1]
      c: [Sprint 2]
      a --> b
      b --> c
    }`);
    for (const n of diagram.nodes) {
      expect((n.data as any).ganttMilestone).toBe(false);
      expect(n.position.x).toBeGreaterThanOrEqual(0);
    }
    // Sequential fallback: each task starts to the right of the previous one.
    const xs = diagram.nodes.map((n) => n.position.x);
    expect(xs[1]).toBeGreaterThan(xs[0]);
    expect(xs[2]).toBeGreaterThan(xs[1]);
  });

  it('keeps a range ending in an unrecognised month from running backwards', async () => {
    const { diagram } = await layoutOf(`diagram gantt "R" {
      a: [Task: Jan 6 - Foo 17]
    }`);
    expect(diagram.nodes[0].size.width).toBeGreaterThan(0);
  });

  it('parses a real cross-month range', async () => {
    const { diagram } = await layoutOf(`diagram gantt "R" {
      a: [Task: Jan 27 - Feb 14]
    }`);
    expect((diagram.nodes[0].data as any).ganttDuration).toBe(17);
  });
});

describe('gantt time scale', () => {
  // The synthetic calendar is flat 30-day months over a single 360-day year,
  // so a chart longer than that is expressed as consecutive one-year tasks
  // rather than an out-of-range end date.
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dateAt(day: number): string {
    return `${MONTHS[Math.min(11, Math.floor(day / 30))]} ${day % 30 || 30}`;
  }

  /** Build a chart spanning `days` (max 354, the calendar's usable range) and
   *  return its layout together with the span the engine actually laid out. */
  async function spanOf(days: number) {
    const start = 1;
    const end = Math.min(354, start + days);
    const src = `diagram gantt "S" {\n  a: [Task: ${dateAt(start)} - ${dateAt(end)}]\n}`;
    const laid = await layoutOf(src);
    return { ...laid, actualSpan: end - start };
  }

  it('fills a comparable width whether the project is short or long', async () => {
    const short = await spanOf(14);
    const long = await spanOf(200);
    // Pre-fix these differed by ~3x purely from crossing a px-per-day bucket.
    const ratio = long.bounds.width / short.bounds.width;
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(1.4);
  });

  it('does not collapse when the span crosses a tick-unit boundary', async () => {
    const before = await spanOf(21);
    const after = await spanOf(22);
    expect(Math.abs(after.bounds.width - before.bounds.width)).toBeLessThan(60);
  });

  it('keeps the gridline count readable across the full span range', async () => {
    for (const days of [3, 14, 21, 22, 60, 120, 240, 350]) {
      const { diagram, actualSpan } = await spanOf(days);
      const axis = (diagram.nodes[0].data as any).ganttAxis;
      const ticks = (actualSpan * axis.dayWidth) / (axis.dayWidth * axis.unitDays);
      expect(ticks, `${days}d span produced ${ticks.toFixed(1)} ticks`).toBeLessThanOrEqual(24);
      expect(ticks, `${days}d span produced ${ticks.toFixed(1)} ticks`).toBeGreaterThan(0.9);
    }
  });

  it('gives a short chart daily ticks and a year-long one coarser ones', async () => {
    const short = await spanOf(10);
    const long = await spanOf(330);

    expect((short.diagram.nodes[0].data as any).ganttAxis.unit).toBe('day');
    expect((long.diagram.nodes[0].data as any).ganttAxis.unitDays).toBeGreaterThanOrEqual(30);
  });
});

describe('ganttDayLabel', () => {
  it('labels the axis origin Jan 1, never Jan 0', () => {
    expect(ganttDayLabel(0, 'week')).toBe('Jan 1');
  });

  it('rolls an exact month boundary back to the previous month', () => {
    expect(ganttDayLabel(30, 'week')).toBe('Jan 30');
  });
});
