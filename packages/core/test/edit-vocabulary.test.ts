// =============================================================================
// SelDiA — edit vocabulary templates must actually compile
// =============================================================================
// getEditVocabulary() feeds the visual editor's add-node/add-edge palettes
// (see docs/next_steps.md Step 2/3). A template that doesn't parse for its
// own diagram type would make "add node" silently fail the moment someone
// clicked it, so every node and edge template is round-tripped through the
// real engine here instead of only being reviewed by eye.

import { describe, it, expect } from 'vitest';
import { createEngine, DiagramType, getEditVocabulary } from '../src/index.js';

const engine = createEngine();

/** Diagram header for a type, matching the syntax the parser accepts
 *  (`diagram c4 context "T" { ... }` for the two-word C4 types). */
function header(type: DiagramType): string {
  if (type === DiagramType.C4_CONTEXT) return 'diagram c4 context "T"';
  if (type === DiagramType.C4_CONTAINER) return 'diagram c4 container "T"';
  return `diagram ${type} "T"`;
}

function compile(source: string) {
  const parsed = engine.parse(source);
  if (!parsed.ok) return parsed;
  const analyzed = engine.analyze(parsed.value);
  if (!analyzed.ok) return analyzed;
  return engine.transform(analyzed.value);
}

const TYPES_WITH_VOCABULARY = [
  DiagramType.FLOWCHART,
  DiagramType.BPMN,
  DiagramType.SEQUENCE,
  DiagramType.CLASS,
  DiagramType.ER,
  DiagramType.STATE,
  DiagramType.C4_CONTEXT,
  DiagramType.C4_CONTAINER,
];

describe('getEditVocabulary', () => {
  it('falls back to the generic flowchart-style vocabulary for a type with no dedicated entry', () => {
    const vocab = getEditVocabulary(DiagramType.MINDMAP);
    expect(vocab.nodes.length).toBeGreaterThan(0);
    expect(vocab.edges.length).toBeGreaterThan(0);
  });

  for (const type of TYPES_WITH_VOCABULARY) {
    describe(type, () => {
      const vocab = getEditVocabulary(type);

      for (const entry of vocab.nodes) {
        it(`node kind '${entry.kind}' compiles and produces a node`, () => {
          const stmt = entry.template.replace(/\{id\}/g, 'nodeX').replace(/\{label\}/g, 'New Node');
          const source = `${header(type)} {\n    ${stmt}\n}`;
          const result = compile(source);
          expect(result.ok, !result.ok ? JSON.stringify((result as any).errors ?? result) : '').toBe(true);
          if (result.ok) {
            expect(result.value.nodes.some((n) => n.id === 'nodeX')).toBe(true);
          }
        });
      }

      for (const entry of vocab.edges) {
        it(`edge kind '${entry.kind}' compiles and produces an edge`, () => {
          // Two nodes via the type's own first vocabulary entry, then the
          // edge template between them.
          const nodeEntry = vocab.nodes[0];
          const a = nodeEntry.template.replace(/\{id\}/g, 'a').replace(/\{label\}/g, 'A');
          const b = nodeEntry.template.replace(/\{id\}/g, 'b').replace(/\{label\}/g, 'B');
          const edgeStmt = entry.template.replace('{source}', 'a').replace('{target}', 'b');
          const source = `${header(type)} {\n    ${a}\n    ${b}\n    ${edgeStmt}\n}`;
          const result = compile(source);
          expect(result.ok, !result.ok ? JSON.stringify((result as any).errors ?? result) : '').toBe(true);
          if (result.ok) {
            expect(result.value.edges.length).toBeGreaterThan(0);
          }
        });
      }
    });
  }
});
