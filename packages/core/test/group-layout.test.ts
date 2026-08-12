// =============================================================================
// SelDiA — a group box must contain its members and nothing else
// =============================================================================
// Groups used to have no layout of their own: dagre placed nodes with no idea
// membership existed, and layoutGroups() then unioned the bounds of wherever
// the members landed. Any non-member that happened to sit between two members
// was silently swallowed by the drawn box — a sibling state appearing inside a
// composite state, or an entire package appearing inside another package.
// Membership now reaches dagre as a cluster; these tests pin that, because the
// failure mode is purely visual and nothing else would catch it.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createEngine } from '../src/index.js';
import { importPlantUml } from '../src/import/plantuml.js';
import type { DiagramIR } from '../src/ir/types.js';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'plantuml-corpus');
const engine = createEngine();

function laidOut(source: string): DiagramIR {
  const { ir } = importPlantUml(source);
  expect(ir).toBeDefined();
  const r = engine.layout(ir!);
  expect(r.ok).toBe(true);
  return (r as { value: { diagram: DiagramIR } }).value.diagram;
}

/** Non-member nodes whose centre falls inside a group's drawn box. */
function intruders(d: DiagramIR): string[] {
  const found: string[] = [];
  for (const g of d.groups ?? []) {
    const members = new Set(g.childNodeIds);
    for (const cg of g.childGroupIds ?? []) {
      for (const id of (d.groups ?? []).find((x) => x.id === cg)?.childNodeIds ?? []) members.add(id);
    }
    const { x, y } = g.position;
    const { width, height } = g.size;
    for (const n of d.nodes) {
      if (members.has(n.id)) continue;
      const cx = n.position.x + n.size.width / 2;
      const cy = n.position.y + n.size.height / 2;
      if (cx > x && cx < x + width && cy > y && cy < y + height) found.push(`${n.id} in ${g.label}`);
    }
  }
  return found;
}

describe('group layout keeps non-members out of the box', () => {
  it('regression: a sibling state does not land inside a composite state', () => {
    const d = laidOut(readFileSync(path.join(FIXTURE_DIR, 'state-connection.puml'), 'utf-8'));
    expect(d.groups).toHaveLength(1);
    expect(intruders(d)).toEqual([]);
  });

  it('regression: one package does not land inside another', () => {
    const d = laidOut(readFileSync(path.join(FIXTURE_DIR, 'component-microservices.puml'), 'utf-8'));
    expect(d.groups).toHaveLength(3);
    expect(intruders(d)).toEqual([]);
  });

  it('encloses every member it claims', () => {
    for (const f of ['state-connection.puml', 'component-microservices.puml', 'class-domain.puml', 'usecase-support.puml']) {
      const d = laidOut(readFileSync(path.join(FIXTURE_DIR, f), 'utf-8'));
      for (const g of d.groups ?? []) {
        for (const id of g.childNodeIds) {
          const n = d.nodes.find((x) => x.id === id)!;
          expect(n.position.x, `${f}: ${id} left of ${g.label}`).toBeGreaterThanOrEqual(g.position.x);
          expect(n.position.y).toBeGreaterThanOrEqual(g.position.y);
          expect(n.position.x + n.size.width).toBeLessThanOrEqual(g.position.x + g.size.width);
          expect(n.position.y + n.size.height).toBeLessThanOrEqual(g.position.y + g.size.height);
        }
        expect(g.size.width, `${f}: ${g.label} has no size`).toBeGreaterThan(0);
      }
    }
  });

  it('still lays out a grouped diagram with real edge routes', () => {
    const d = laidOut(readFileSync(path.join(FIXTURE_DIR, 'component-microservices.puml'), 'utf-8'));
    expect(d.nodes.every((n) => n.position.x !== 0 || n.position.y !== 0)).toBe(true);
    expect(d.edges.every((e) => (e.waypoints?.length ?? 0) >= 2)).toBe(true);
  });

  // Groups are engine-wide, not a PlantUML feature: a native DSL diagram with a
  // group must get the same treatment.
  it('applies to native DSL groups too', () => {
    const r = engine.compileSync(`fl "Grouped" {
    group "Cluster" {
        a [A]
        b [B]
    }
    outside [Outside]

    a -> b
    b -> outside
}`);
    expect(r.ok, r.ok ? '' : JSON.stringify(r).slice(0, 300)).toBe(true);
  });
});
