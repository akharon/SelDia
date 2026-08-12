// =============================================================================
// SelDiA — Work-Item Diagram
// =============================================================================
// Two things distinguish this type from every other diagram type, and both are
// what these tests are mostly about:
//
//   1. Sections are PER-TYPE. A field that isn't a section of the item's own
//      type is dropped rather than rendered, so the schema stays meaningful.
//   2. The diagram can be WRONG. Only a test may `verify`; `satisfies` must
//      point at a requirement or capability. A traceability matrix that cannot
//      be wrong is just boxes with arrows.
//
// Everything validate() reports is a warning, never an error — an incomplete
// specification is the normal state of a specification, and a tool that refuses
// to draw one is useless exactly when it is most needed. The "still compiles"
// assertions below pin that.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/index.js';
import { DiagramType } from '../src/ir/types.js';
import { sectionsFor, LINK_RULES, ITEM_KEYWORDS } from '../src/workitem/schema.js';
import type { DiagramIR } from '../src/ir/types.js';

const engine = createEngine();

function irOf(src: string): DiagramIR {
  const parsed = engine.parse(src);
  expect(parsed.ok, parsed.ok ? '' : JSON.stringify(parsed.errors).slice(0, 300)).toBe(true);
  if (!parsed.ok) throw new Error('unreachable');
  const analyzed = engine.analyze(parsed.value);
  expect(analyzed.ok).toBe(true);
  if (!analyzed.ok) throw new Error('unreachable');
  const ir = engine.transform(analyzed.value);
  expect(ir.ok, ir.ok ? '' : JSON.stringify(ir.errors).slice(0, 300)).toBe(true);
  if (!ir.ok) throw new Error('unreachable');
  return ir.value;
}

function warningsOf(src: string): string[] {
  const parsed = engine.parse(src);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('unreachable');
  return engine.validateSemantics(parsed.value).map((d) => d.message);
}

const SAMPLE = `wi "Login" {
  CAP1 [Users can authenticate] { type: capability, outcome: "Access is controlled", measure: "99% success" }
  REQ1 [Sign in with a password] {
    type: requirement
    description: "A returning user signs in with email and password."
    justification: "Table stakes for an account-based product."
    priority: high
    status: approved
  }
  ADR1 [Use OAuth 2.0] { type: decision, rationale: "Avoids storing passwords.", status: accepted }
  STORY1 [Login screen] { type: story, acceptance: "Given valid input, the user reaches the dashboard.", estimation: 5 }
  TEST1 [Valid login works] { type: test, given: "A registered user", expected: "Dashboard", result: passing }
  RISK1 [IdP outage] { type: risk, impact: high, likelihood: low, mitigation: "Cache tokens." }

  REQ1 -> CAP1: refines
  STORY1 -> REQ1: satisfies
  TEST1 -> REQ1: verifies
  TEST1 -> CAP1: verifies
  ADR1 -> RISK1: mitigates
}`;

describe('work-item parsing and IR', () => {
  const ir = irOf(SAMPLE);

  it('routes the wi/workitem/trace aliases to one type', () => {
    for (const alias of ['wi', 'workitem', 'trace', 'backlog']) {
      expect(irOf(`${alias} "T" { A [X] { type: requirement } }`).type).toBe(DiagramType.WORKITEM);
    }
  });

  it('reads the item type off each declaration', () => {
    const types = Object.fromEntries(ir.nodes.map((n) => [n.id, n.data.itemType]));
    expect(types).toEqual({
      CAP1: 'capability', REQ1: 'requirement', ADR1: 'decision',
      STORY1: 'story', TEST1: 'test', RISK1: 'risk',
    });
  });

  it('keeps section values on the node, not in the label', () => {
    const req = ir.nodes.find((n) => n.id === 'REQ1')!;
    expect(req.label).toBe('Sign in with a password');
    expect(req.data.fields).toMatchObject({ priority: 'high', status: 'approved' });
    expect((req.data.fields as Record<string, unknown>).justification).toContain('Table stakes');
  });

  it('records the link kind on each edge', () => {
    const kinds = ir.edges.map((e) => e.data.linkKind);
    expect(kinds).toEqual(['refines', 'satisfies', 'verifies', 'verifies', 'mitigates']);
  });

  // Per-type sections are the schema's whole point: an estimate is meaningful
  // on a story and meaningless on a decision.
  it('drops a field that is not a section of that item type', () => {
    const d = irOf('wi "T" { A [X] { type: decision, rationale: "why", estimation: 5 } }');
    const fields = d.nodes[0].data.fields as Record<string, unknown>;
    expect(fields.rationale).toBe('why');
    expect(fields).not.toHaveProperty('estimation');
  });

  it('keeps that same field when the type does declare it', () => {
    const d = irOf('wi "T" { A [X] { type: story, estimation: 5 } }');
    expect((d.nodes[0].data.fields as Record<string, unknown>).estimation).toBe(5);
  });

  // Attribute-block keys all arrive in `style` from the shared parser, so the
  // split between renderer style and item sections happens in the plugin.
  it('separates renderer style from item sections', () => {
    const d = irOf('wi "T" { A [X] { type: risk, impact: high, stroke: "#ff0000", fontSize: 11 } }');
    const n = d.nodes[0];
    expect(n.style).toMatchObject({ stroke: '#ff0000', fontSize: 11 });
    expect(n.data.fields).toEqual({ impact: 'high' });
  });

  it('sizes a card from the sections it will actually draw', () => {
    const bare = irOf('wi "T" { A [X] { type: requirement } }').nodes[0];
    const full = irOf('wi "T" { A [X] { type: requirement, description: "d", status: s, owner: o, priority: p } }').nodes[0];
    expect(full.size.height).toBeGreaterThan(bare.size.height);
    expect(bare.size.width).toBe(full.size.width);
  });

  it('renders to real SVG through the engine', () => {
    const r = engine.compileSync(SAMPLE);
    expect(r.ok, r.ok ? '' : JSON.stringify(r).slice(0, 300)).toBe(true);
    if (r.ok) {
      expect(r.value.svg).toContain('<svg');
      // The type badge is what makes a card readable at a glance.
      for (const badge of ['REQ', 'ADR', 'TEST', 'STORY', 'RISK', 'CAP']) {
        expect(r.value.svg, `badge ${badge}`).toContain(`>${badge}<`);
      }
    }
  });
});

describe('work-item validation', () => {
  it('accepts a well-formed traceability graph', () => {
    expect(warningsOf(SAMPLE)).toEqual([]);
  });

  it('rejects a link whose source type may not make it', () => {
    const w = warningsOf('wi "T" { A [x] { type: requirement } B [y] { type: feature } A -> B: verifies }');
    expect(w.some((m) => /A requirement cannot verify/.test(m))).toBe(true);
  });

  it('rejects a link pointing at the wrong target type', () => {
    const w = warningsOf('wi "T" { A [x] { type: test } B [y] { type: decision } A -> B: verifies }');
    expect(w.some((m) => /verifies cannot point at a decision/.test(m))).toBe(true);
  });

  it('leaves unconstrained links alone', () => {
    const w = warningsOf('wi "T" { A [x] { type: risk } B [y] { type: decision } A -> B: depends\n A -> B: conflicts }');
    expect(w.filter((m) => /cannot/.test(m))).toEqual([]);
  });

  it('reports an unknown item type and an unknown link', () => {
    const w = warningsOf('wi "T" { A [x] { type: epic } B [y] { type: test } B -> A: frobnicates }');
    expect(w.some((m) => /Unknown work-item type "epic"/.test(m))).toBe(true);
    expect(w.some((m) => /Unknown link "frobnicates"/.test(m))).toBe(true);
  });

  it('reports a field that will not be shown rather than dropping it silently', () => {
    const w = warningsOf('wi "T" { A [x] { type: decision, estimation: 5 } }');
    expect(w.some((m) => /"estimation" is not a section of a decision/.test(m))).toBe(true);
  });

  // The question a traceability diagram exists to answer.
  it('reports requirements and capabilities with no test covering them', () => {
    const w = warningsOf('wi "T" { A [x] { type: requirement } C [z] { type: capability } B [y] { type: test } B -> A: verifies }');
    expect(w.some((m) => /capability "C" has no test verifying it/.test(m))).toBe(true);
    expect(w.some((m) => /requirement "A" has no test/.test(m))).toBe(false);
  });

  it('does not report coverage for types that need none', () => {
    const w = warningsOf('wi "T" { A [x] { type: story } B [y] { type: decision } }');
    expect(w.filter((m) => /has no test/.test(m))).toEqual([]);
  });

  // Every finding is a warning: a half-written spec is the normal case.
  it('still compiles a diagram with every kind of problem in it', () => {
    const broken = `wi "Broken" {
  A [x] { type: epic, nonsense: 1 }
  B [y] { type: requirement }
  A -> B: frobnicates
  B -> A: verifies
}`;
    expect(warningsOf(broken).length).toBeGreaterThan(3);
    expect(engine.compileSync(broken).ok).toBe(true);
  });

  it('returns nothing for a diagram type with no plugin checks', () => {
    const parsed = engine.parse('fl "T" { a [A] b [B] a -> b }');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(engine.validateSemantics(parsed.value)).toEqual([]);
  });
});

describe('work-item schema', () => {
  it('gives every item type the common sections plus its own', () => {
    for (const t of new Set(Object.values(ITEM_KEYWORDS))) {
      const keys = sectionsFor(t).map((s) => s.key);
      expect(keys, `${t} common sections`).toEqual(expect.arrayContaining(['description', 'status', 'owner']));
      expect(new Set(keys).size, `${t} has duplicate section keys`).toBe(keys.length);
    }
  });

  it('only allows a test to verify', () => {
    expect(LINK_RULES.verifies!.from).toEqual(['test']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Theming. A work-item card is the only node that paints its own SURFACE and
// then writes body text on it, so it is the one place where a palette that
// flips text to a light tone without flipping the ground produces an
// invisible, white-on-white card. It still compiles and still passes any
// "no error box" assertion — which is exactly how this shipped broken — so the
// contract has to be pinned on the colors themselves.
// ─────────────────────────────────────────────────────────────────────────────
describe('work-item card theming', () => {
  const SRC = `wi "T" {
  CAP1 [Customers can pay] { type: capability, description: "Accept payment.", status: active }
  REQ1 [Cards accepted] { type: requirement, description: "Pay by card.", status: approved }
  REQ1 -> CAP1: refines
}`;

  function svgFor(palette?: string): string {
    const e = palette ? createEngine({ config: { render: { palette } } } as any) : createEngine();
    const r = e.compileSync(SRC);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    return r.value.svg;
  }

  /** Relative luminance, mirroring the renderer's own test for "dark ground". */
  function lum(hex: string): number {
    const n = parseInt(/^#([0-9a-f]{6})$/i.exec(hex.trim())![1], 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** The card body fill: the first solid fill inside the CAP1 node group. */
  function cardFill(svg: string): string {
    const i = svg.indexOf('data-seldia-node-id="CAP1"');
    expect(i).toBeGreaterThan(-1);
    const m = /<(?:rect|path)\b[^>]*?fill="(#[0-9a-f]{6})"/i.exec(svg.slice(i, i + 2500));
    return m![1];
  }

  it('keeps body text legible against the card surface it paints', () => {
    for (const palette of [undefined, 'dark', 'high-contrast']) {
      const svg = svgFor(palette);
      const surface = lum(cardFill(svg));
      // Every run of body text drawn inside a card must contrast with it.
      const texts = [...svg.matchAll(/<text[^>]*fill="(#[0-9a-f]{6})"[^>]*font-size="11"/gi)].map((m) => m[1]);
      expect(texts.length, `${palette ?? 'default'} has body text`).toBeGreaterThan(0);
      for (const t of texts) {
        expect(
          Math.abs(lum(t) - surface),
          `${palette ?? 'default'}: body text ${t} on card ${cardFill(svg)}`,
        ).toBeGreaterThan(0.15);
      }
    }
  });

  it('paints a dark card surface under a dark palette', () => {
    // The regression itself: neutralText flipped but the surface stayed #ffffff.
    expect(lum(cardFill(svgFor('dark')))).toBeLessThan(0.5);
    expect(lum(cardFill(svgFor()))).toBeGreaterThan(0.5);
  });
});
