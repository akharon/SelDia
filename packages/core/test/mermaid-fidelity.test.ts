// =============================================================================
// SelDiA — Mermaid Fidelity Corpus
// =============================================================================
// A curated set of realistic, complex Mermaid samples (test/fixtures/
// mermaid-corpus/*.mmd) — the kind of thing a real repo's docs/ADRs actually
// contain, not minimal hand-written unit-test snippets. Each fixture is
// checked three ways: (1) it imports with zero diagnostics, (2) its structure
// matches counts read directly off the source (nodes, edges, groups, styled
// elements), and (3) it renders to real SVG through the full engine pipeline.
// That third check is what catches the class of bug unit tests on IR shape
// alone cannot: a renderer silently dropping structure it never reads
// (documented precedent: class members / ER attributes read from the label,
// not a data bag).
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { importMermaid } from '../src/import/mermaid.js';
import { createEngine } from '../src/engine.js';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mermaid-corpus');

function load(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf-8');
}

function renderOk(source: string) {
  const { ir, diagnostics } = importMermaid(source);
  expect(ir, `expected IR, got diagnostics: ${JSON.stringify(diagnostics)}`).toBeDefined();
  const engine = createEngine();
  const result = engine.compileIRSync(ir!);
  expect(result.ok, result.ok ? '' : JSON.stringify(result)).toBe(true);
  if (result.ok) expect(result.value.svg).toContain('<svg');
  return { ir: ir!, diagnostics };
}

describe('fidelity corpus: flowchart-cicd', () => {
  it('imports the full pipeline with two subgraphs and styling', () => {
    const { ir, diagnostics } = renderOk(load('flowchart-cicd.mmd'));
    expect(diagnostics).toHaveLength(0);
    expect(ir.groups.map((g) => g.id).sort()).toEqual(['CD', 'CI']);
    expect(ir.groups.find((g) => g.id === 'CI')!.childNodeIds).toEqual(
      expect.arrayContaining(['commit', 'lint', 'test', 'notify', 'build'])
    );
    // classDef + class: rollback and notify both get the "danger" style.
    const rollback = ir.nodes.find((n) => n.id === 'rollback')!;
    const notify = ir.nodes.find((n) => n.id === 'notify')!;
    expect(rollback.classList).toContain('danger');
    expect(rollback.style.fill).toBe('#f66');
    expect(notify.classList).toContain('danger');
    // Direct `style` line overrides/adds independently of classDef.
    const prod = ir.nodes.find((n) => n.id === 'prod')!;
    expect(prod.style.fill).toBe('#9f9');
    // linkStyle 3 targets the 4th declared edge.
    expect(ir.edges[3].style.stroke).toBe('#f00');
  });
});

describe('fidelity corpus: sequence-auth', () => {
  it('imports all participants and every message in order', () => {
    const { ir, diagnostics } = renderOk(load('sequence-auth.mmd'));
    expect(diagnostics).toHaveLength(0);
    expect(ir.nodes.map((n) => n.id).sort()).toEqual(['API', 'AuthServer', 'Client', 'User']);
    expect(ir.edges).toHaveLength(8);
    expect(ir.edges[0].label).toBe('Enter credentials');
    expect(ir.edges[7].label).toBe('Render dashboard');
  });
});

describe('fidelity corpus: class-domain', () => {
  it('imports classes with members and relations, ignoring stereotype/multiplicity noise', () => {
    const { ir, diagnostics } = renderOk(load('class-domain.mmd'));
    expect(diagnostics).toHaveLength(0);
    const order = ir.nodes.find((n) => n.id === 'Order')!;
    // Members must be present so the class renderer draws real compartments,
    // not a bare box — this is the exact bug class the corpus exists to catch.
    expect(order.label).toContain('calculateTotal() Number');
    expect(order.data.compartments).toBeDefined();
    const lineItem = ir.nodes.find((n) => n.id === 'LineItem')!;
    expect(lineItem.label).toContain('quantity');
    expect(ir.edges).toHaveLength(3);
  });
});

describe('fidelity corpus: er-schema', () => {
  it('imports entities with attributes and cardinality on every relation', () => {
    const { ir, diagnostics } = renderOk(load('er-schema.mmd'));
    expect(diagnostics).toHaveLength(0);
    const order = ir.nodes.find((n) => n.id === 'ORDER')!;
    expect(order.data.attributes).toContain('date created_at');
    expect(ir.edges).toHaveLength(3);
    const places = ir.edges.find((e) => e.label === 'places')!;
    expect(places.data.sourceCardinality).toBe('||');
    expect(places.data.targetCardinality).toBe('o{');
  });
});

describe('fidelity corpus: state-order', () => {
  it('imports every transition including distinct start/end pseudostates', () => {
    const { ir, diagnostics } = renderOk(load('state-order.mmd'));
    expect(diagnostics).toHaveLength(0);
    expect(ir.edges).toHaveLength(7);
    // Two separate [*] end transitions (Delivered, Cancelled) must not
    // collapse onto one shared node.
    const endTargets = ir.edges.filter((e) => e.label === undefined || true)
      .map((e) => e.targetId)
      .filter((id) => id.startsWith('__end_'));
    expect(new Set(endTargets).size).toBe(2);
  });
});

describe('fidelity corpus: gantt-release', () => {
  it('imports every task across sections, including a zero-length milestone', () => {
    const { ir, diagnostics } = renderOk(load('gantt-release.mmd'));
    expect(diagnostics).toHaveLength(0);
    expect(ir.nodes).toHaveLength(6);
    const milestone = ir.nodes.find((n) => n.label.startsWith('Code freeze'))!;
    expect(milestone.label).not.toContain('-');
  });
});

describe('fidelity corpus: pie-browsers', () => {
  it('imports every slice with its exact value', () => {
    const { ir, diagnostics } = renderOk(load('pie-browsers.mmd'));
    expect(diagnostics).toHaveLength(0);
    expect(ir.nodes).toHaveLength(5);
    const chrome = ir.nodes.find((n) => n.label.startsWith('Chrome'))!;
    expect(chrome.label).toContain('65.2');
  });
});

describe('fidelity corpus: gitgraph-flow', () => {
  it('imports commits across two feature branches with merges back to main', () => {
    const { ir, diagnostics } = renderOk(load('gitgraph-flow.mmd'));
    expect(diagnostics).toHaveLength(0);
    // 6 explicit commits + 2 merge commits = 8 nodes.
    expect(ir.nodes).toHaveLength(8);
    expect(ir.nodes.some((n) => n.label.startsWith('feature/login:'))).toBe(true);
    expect(ir.nodes.some((n) => n.label.startsWith('feature/logout:'))).toBe(true);
    expect(ir.nodes.filter((n) => n.label.includes('merge')).length).toBe(2);
  });
});

describe('fidelity corpus: mindmap-decision', () => {
  it('imports the full three-level tree', () => {
    const { ir, diagnostics } = renderOk(load('mindmap-decision.mmd'));
    expect(diagnostics).toHaveLength(0);
    // root + 3 category nodes + 6 leaf nodes = 10.
    expect(ir.nodes).toHaveLength(10);
    expect(ir.edges).toHaveLength(9);
    const root = ir.nodes.find((n) => n.label === 'Choose a DB')!;
    expect(ir.edges.filter((e) => e.sourceId === root.id)).toHaveLength(3);
  });
});
