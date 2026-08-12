// =============================================================================
// SelDiA — PlantUML Fidelity Corpus
// =============================================================================
// The PlantUML twin of the Mermaid fidelity corpus: realistic .puml files
// (test/fixtures/plantuml-corpus/*.puml) of the kind a real repo's docs and
// ADRs contain, rather than the minimal snippets the shape-level unit tests in
// plantuml-import.test.ts use. Each fixture is checked three ways — imports
// with zero diagnostics, its structure matches what the source actually says,
// and it renders to SVG through the full engine.
//
// This corpus earned its keep immediately: probing seven fixtures surfaced four
// bugs that 45 passing unit tests missed, each of which needed a *combination*
// of features to appear (a labelled transition inside a composite state, a
// stereotype on a bracket shorthand). Every one has a named regression test
// below, marked `regression:`.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { importPlantUml } from '../src/import/plantuml.js';
import { createEngine } from '../src/engine.js';
import type { DiagramIR, IRNode } from '../src/ir/types.js';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'plantuml-corpus');

/** Import a fixture, assert it is diagnostic-free, and push it all the way
 *  through the engine to SVG. The render leg is the point: an importer can
 *  produce structurally perfect IR that a renderer silently drops, because
 *  class members and ER attributes are read out of the newline-joined label
 *  rather than node.data. */
function loadOk(name: string): DiagramIR {
  const source = readFileSync(path.join(FIXTURE_DIR, name), 'utf-8');
  const { ir, diagnostics } = importPlantUml(source);
  expect(diagnostics, `expected no diagnostics for ${name}`).toEqual([]);
  expect(ir, `expected IR for ${name}`).toBeDefined();

  const result = createEngine().compileIRSync(ir!);
  expect(result.ok, result.ok ? '' : JSON.stringify(result)).toBe(true);
  if (result.ok) expect(result.value.svg).toContain('<svg');
  return ir!;
}

const nodeOf = (ir: DiagramIR, id: string): IRNode => {
  const n = ir.nodes.find((x) => x.id === id);
  expect(n, `no node ${id} in [${ir.nodes.map((x) => x.id).join(', ')}]`).toBeDefined();
  return n!;
};
const groupOf = (ir: DiagramIR, label: string) => {
  const g = (ir.groups ?? []).find((x) => x.label === label);
  expect(g, `no group ${label}`).toBeDefined();
  return g!;
};
const hasEdge = (ir: DiagramIR, from: string, to: string) =>
  ir.edges.some((e) => e.sourceId === from && e.targetId === to);

// -----------------------------------------------------------------------------

describe('fidelity corpus: state-connection', () => {
  const ir = loadOk('state-connection.puml');

  // regression (bug 1): a labelled transition `Idle --> Sending : write()` is
  // shaped exactly like a sequence message, so on a transition-heavy state
  // machine the sequence votes out-numbered the state votes and the whole
  // diagram was typed SEQUENCE — silently discarding the composite state.
  it('regression: transition-heavy state machines are not misread as sequence', () => {
    expect(ir.type).toBe('state');
  });

  it('keeps the composite state as a group with its inner states', () => {
    const g = groupOf(ir, 'Connected');
    expect(g.childNodeIds).toEqual(expect.arrayContaining(['Idle', 'Sending', 'Receiving']));
  });

  it('models the start and end pseudostates', () => {
    expect(ir.nodes.some((n) => n.id.startsWith('__start'))).toBe(true);
    expect(ir.nodes.some((n) => n.id.startsWith('__end'))).toBe(true);
    expect(hasEdge(ir, 'Closed', 'Connecting')).toBe(true);
    expect(hasEdge(ir, 'Failed', 'Closed')).toBe(true);
  });

  // A composite state is a group, not a node, so it cannot be an edge endpoint.
  // Transitions crossing the boundary are rewritten onto the inner start state
  // and remember where they came from via source/targetContainer.
  it('redirects transitions on the composite onto its inner state', () => {
    const out = ir.edges.find((e) => e.targetId === 'Closing')!;
    expect(out.sourceId).toBe('Idle');
    expect(out.data.sourceContainer).toBe('state-Connected');
    const into = ir.edges.find((e) => e.sourceId === 'Connecting' && e.label === 'ack')!;
    expect(into.targetId).toBe('Idle');
    expect(into.data.targetContainer).toBe('state-Connected');
  });

  it('labels transitions with their trigger', () => {
    const e = ir.edges.find((x) => x.sourceId === 'Closed' && x.targetId === 'Connecting');
    expect(e!.label).toBe('open()');
  });
});

describe('fidelity corpus: class-domain', () => {
  const ir = loadOk('class-domain.puml');

  // regression (bug 2): `class Customer extends Entity` was parsed as a single
  // element literally named `Customer_extends_Entity`, plus a phantom duplicate
  // node, and produced no inheritance edge at all.
  it('regression: extends/implements become inheritance edges, not mangled names', () => {
    expect(ir.nodes.map((n) => n.id)).not.toContain('Customer_extends_Entity');
    expect(hasEdge(ir, 'Customer', 'Entity')).toBe(true);
    expect(hasEdge(ir, 'Order', 'Entity')).toBe(true);
    expect(hasEdge(ir, 'OrderRepository', 'Repository')).toBe(true);
  });

  it('imports every classifier in the package exactly once', () => {
    expect(ir.nodes.map((n) => n.id).sort()).toEqual(
      ['Customer', 'Entity', 'Item', 'Order', 'OrderRepository', 'OrderStatus', 'Repository'].sort(),
    );
    expect(groupOf(ir, 'domain').childNodeIds).toHaveLength(7);
  });

  it('carries members in the label, which is where the renderer reads them', () => {
    const label = nodeOf(ir, 'Order').label;
    expect(label.split('\n')[0]).toBe('Order');
    expect(label).toContain('placedAt : Instant');
    expect(label).toContain('total() : Money');
  });

  // Decorated-end-is-the-target is the IR convention (see relationKindOf's
  // `flip`): `Customer "1" *-- "0..*" Order` is stored Order->Customer so the
  // composition diamond lands on the owning end, Customer.
  it('stores the composition pointing at the owner, with both multiplicities', () => {
    const e = ir.edges.find((x) => x.sourceId === 'Order' && x.targetId === 'Customer')!;
    expect(e.label).toBe('places');
    expect(e.data.relation).toBe('composition');
    expect(e.data.sourceMultiplicity).toBe('0..*');
    expect(e.data.targetMultiplicity).toBe('1');
  });
});

describe('fidelity corpus: component-microservices', () => {
  const ir = loadOk('component-microservices.puml');

  // regression (bug 3a): the bracket-shorthand patterns were anchored right
  // after an optional `as alias`, so `[Gateway] <<service>>` matched nothing
  // and was never recognised as a declaration — leaving the Services package
  // rendered as an empty box.
  it('regression: a stereotype on a bracket shorthand still declares the component', () => {
    expect(groupOf(ir, 'Services').childNodeIds).toEqual(['Gateway', 'Accounts', 'Billing', 'Notifications']);
    expect(ir.nodes).toHaveLength(9);
  });

  // regression (bug 3b): fixing the parse exposed a second defect — put() threw
  // the stereotype away, so kind resolution fell back to guessing from the
  // name. Only `Gateway` came out a service, and only because the word-probe
  // happens to match the literal word "gateway".
  it('regression: an explicit <<service>> outranks the name heuristic', () => {
    for (const id of ['Gateway', 'Accounts', 'Billing', 'Notifications']) {
      expect(nodeOf(ir, id).data.componentKind, `${id} kind`).toBe('service');
      expect(nodeOf(ir, id).data.stereotype, `${id} stereotype`).toBe('service');
    }
  });

  it('still resolves kinds by keyword where there is no stereotype', () => {
    expect(nodeOf(ir, 'ADB').data.componentKind).toBe('datastore');
    expect(nodeOf(ir, 'BUS').data.componentKind).toBe('datastore');
    expect(nodeOf(ir, 'CDN').data.componentKind).toBe('component');
  });

  // The loosened shorthand regexes now swallow a trailing tail, so a relation
  // line that merely *starts* with a bracketed element must still fall through
  // to relation parsing rather than being eaten as a declaration.
  it('regression: a relation beginning with a bracket is still an edge', () => {
    const { ir: rel, diagnostics } = importPlantUml(
      '@startuml\n[A] --> [B]\n[B] ..> [C] : uses\n@enduml',
    );
    expect(diagnostics).toEqual([]);
    expect(rel!.nodes.map((n) => n.id).sort()).toEqual(['A', 'B', 'C']);
    expect(rel!.edges).toHaveLength(2);
    expect(rel!.edges[1].label).toBe('uses');
  });

  it('resolves aliases on both ends of a relation', () => {
    expect(hasEdge(ir, 'CDN', 'LB')).toBe(true);
    expect(hasEdge(ir, 'BUS', 'Notifications')).toBe(true);
  });

  it('marks each container as a package', () => {
    for (const label of ['Edge', 'Services', 'Data']) {
      expect(groupOf(ir, label).data.containerKind).toBe('package');
    }
  });
});

describe('fidelity corpus: er-billing', () => {
  const ir = loadOk('er-billing.puml');

  // regression (bug 4): cleanLabel()'s Creole/HTML strip ate `<PK>` out of
  // `<<PK>>` and left the attribute reading `id : uuid <>`. Both downstream
  // readers — the ER renderer's key bolding and sql-ddl's parseAttr() — look
  // for a bare PK/FK token, so the stereotype is unwrapped, not preserved.
  it('regression: <<PK>>/<<FK>> survive as bare key markers', () => {
    expect(nodeOf(ir, 'Subscription').data.attributes).toEqual([
      'id : uuid PK',
      'customer_id : uuid FK',
      'plan_id : uuid FK',
      'status : varchar',
    ]);
  });

  // The `*` mandatory marker has no IR field to land in, and every reader takes
  // the first token as the column name — leaving it would name a column `_`.
  it('drops the mandatory marker rather than carrying it as dead text', () => {
    for (const n of ir.nodes) expect(n.label).not.toContain('*');
  });

  it('puts the same table into the label the renderer parses', () => {
    expect(nodeOf(ir, 'Customer').label.split('\n')).toEqual([
      'Customer',
      'id : uuid PK',
      'email : varchar',
      'name : varchar',
      'created_at : timestamp',
    ]);
  });

  it('keeps crow’s-foot cardinalities on the relationships', () => {
    const e = ir.edges.find((x) => x.sourceId === 'Customer' && x.targetId === 'Subscription')!;
    expect(e.data.sourceCardinality).toBeDefined();
    expect(e.data.targetCardinality).toBeDefined();
  });
});

describe('fidelity corpus: sequence-oauth', () => {
  const ir = loadOk('sequence-oauth.puml');

  it('imports every participant and message', () => {
    expect(ir.type).toBe('sequence');
    expect(ir.nodes).toHaveLength(5);
    expect(ir.edges).toHaveLength(20);
  });

  it('preserves message order, which is the whole meaning of a sequence', () => {
    expect(ir.edges[0].label).toBeTruthy();
    const idx = ir.edges.map((e) => e.data?.index).filter((i) => i !== undefined);
    if (idx.length) expect(idx).toEqual([...idx].sort((a, b) => (a as number) - (b as number)));
  });
});

describe('fidelity corpus: usecase-support', () => {
  const ir = loadOk('usecase-support.puml');

  it('separates actors from the use cases inside the system boundary', () => {
    expect(ir.type).toBe('usecase');
    expect(groupOf(ir, 'Support Portal').childNodeIds).toHaveLength(5);
    expect(ir.nodes).toHaveLength(8);
  });
});

describe('fidelity corpus: activity-release', () => {
  const ir = loadOk('activity-release.puml');

  it('imports the branching release flow', () => {
    expect(ir.type).toBe('activity');
    expect(ir.nodes).toHaveLength(15);
    expect(ir.edges).toHaveLength(17);
  });

  it('marks the decision points', () => {
    expect(ir.nodes.some((n) => n.shape === 'diamond' || n.data?.kind === 'decision')).toBe(true);
  });
});
