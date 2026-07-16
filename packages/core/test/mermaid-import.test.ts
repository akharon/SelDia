// =============================================================================
// SelDiA Core — Mermaid importer tests
// =============================================================================
// The engine positioning ("keep your Mermaid") is only as credible as this
// importer, so these tests cover the syntax that actually shows up in repos —
// chained links, both label forms, shape variants, reply arrows — rather than
// one happy-path diagram per type.

import { describe, it, expect } from 'vitest';
import { importMermaid, isMermaidSource } from '../src/index.js';
import { DiagramType } from '../src/ir/types.js';
import { ShapeType } from '../src/types/shapes.js';
import { StrokeStyle } from '../src/types/style.js';

function irOf(src: string) {
  const { ir, diagnostics } = importMermaid(src);
  if (!ir) throw new Error(`no IR: ${diagnostics.map((d) => d.message).join('; ')}`);
  return ir;
}
const idsOf = (ir: ReturnType<typeof irOf>) => ir.nodes.map((n) => n.id).sort();
const edgeOf = (ir: ReturnType<typeof irOf>, from: string, to: string) =>
  ir.edges.find((e) => e.sourceId === from && e.targetId === to);

describe('isMermaidSource', () => {
  it('recognizes supported and not-yet-supported Mermaid headers', () => {
    expect(isMermaidSource('flowchart LR\n a-->b')).toBe(true);
    expect(isMermaidSource('sequenceDiagram\n A->>B: hi')).toBe(true);
    expect(isMermaidSource('%% a comment\ngraph TD\n a-->b')).toBe(true);
    // Not imported yet, but still Mermaid — the caller decides what to do.
    expect(isMermaidSource('pie title Pets\n "Dogs" : 1')).toBe(true);
  });

  it('rejects SelDiA DSL', () => {
    expect(isMermaidSource('diagram flowchart "T" {\n a: (Start)\n}')).toBe(false);
  });
});

describe('flowchart import', () => {
  it('maps every bracket form to the right shape', () => {
    const ir = irOf(`flowchart TD
      a[Rect]
      b(Round)
      c{Diamond}
      d((Circle))
      e([Stadium])
      f[(Database)]
      g[[Subroutine]]
      h{{Hexagon}}
      i[/Parallelogram/]`);
    const shape = (id: string) => ir.nodes.find((n) => n.id === id)!.shape;
    expect(shape('a')).toBe(ShapeType.RECTANGLE);
    expect(shape('b')).toBe(ShapeType.ROUNDED_RECTANGLE);
    expect(shape('c')).toBe(ShapeType.DIAMOND);
    expect(shape('d')).toBe(ShapeType.CIRCLE);
    expect(shape('e')).toBe(ShapeType.STADIUM);
    expect(shape('f')).toBe(ShapeType.CYLINDER);
    expect(shape('g')).toBe(ShapeType.SUBROUTINE);
    expect(shape('h')).toBe(ShapeType.HEXAGON);
    expect(shape('i')).toBe(ShapeType.PARALLELOGRAM);
  });

  it('reads the direction from the header', () => {
    expect(irOf('flowchart LR\n a-->b').metadata.direction).toBe('LR');
    // TD is Mermaid's alias for TB.
    expect(irOf('graph TD\n a-->b').metadata.direction).toBe('TB');
    expect(irOf('graph RL\n a-->b').metadata.direction).toBe('RL');
  });

  it('handles both edge-label forms', () => {
    const piped = irOf('flowchart TD\n A -->|Yes| B');
    expect(edgeOf(piped, 'A', 'B')!.label).toBe('Yes');
    const inline = irOf('flowchart TD\n A -- No --> B');
    expect(edgeOf(inline, 'A', 'B')!.label).toBe('No');
  });

  it('expands a chained link into one edge per hop', () => {
    const ir = irOf('flowchart LR\n a --> b --> c');
    expect(idsOf(ir)).toEqual(['a', 'b', 'c']);
    expect(ir.edges).toHaveLength(2);
    expect(edgeOf(ir, 'a', 'b')).toBeTruthy();
    expect(edgeOf(ir, 'b', 'c')).toBeTruthy();
  });

  it('marks dotted links dashed and open links arrowless', () => {
    const ir = irOf('flowchart TD\n a -.-> b\n c --- d');
    expect(edgeOf(ir, 'a', 'b')!.style.strokeStyle).toBe(StrokeStyle.DASHED);
    expect(edgeOf(ir, 'a', 'b')!.style.arrowhead).toBe(true);
    expect(edgeOf(ir, 'c', 'd')!.style.arrowhead).toBe(false);
  });

  it('lets a later labeled mention upgrade a bare first mention', () => {
    // Mermaid allows forward references; the real label arrives afterwards.
    const ir = irOf('flowchart TD\n A --> B\n B[Real Label]');
    expect(ir.nodes.find((n) => n.id === 'B')!.label).toBe('Real Label');
    expect(ir.nodes).toHaveLength(2);
  });

  it('expands the & shorthand into every combination', () => {
    const ir = irOf('flowchart LR\n  A & B --> C');
    expect(ir.edges).toHaveLength(2);
    expect(edgeOf(ir, 'A', 'C')).toBeTruthy();
    expect(edgeOf(ir, 'B', 'C')).toBeTruthy();

    const cross = irOf('flowchart LR\n  A & B --> C & D');
    expect(cross.edges).toHaveLength(4);
    expect(idsOf(cross)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('does not split on an & that belongs to a label', () => {
    const ir = irOf('flowchart LR\n  rd[R&D] --> ops["Sales & Ops"]');
    expect(idsOf(ir)).toEqual(['ops', 'rd']);
    expect(ir.nodes.find((n) => n.id === 'rd')!.label).toBe('R&D');
    expect(ir.nodes.find((n) => n.id === 'ops')!.label).toBe('Sales & Ops');
    expect(ir.edges).toHaveLength(1);
  });

  it('keeps standalone nodes that have no edges', () => {
    expect(idsOf(irOf('flowchart TD\n A --> B\n Orphan[Alone]'))).toEqual(['A', 'B', 'Orphan']);
  });

  it('unescapes quotes and <br/> in labels', () => {
    const ir = irOf('flowchart TD\n a["Line one<br/>Line two"]');
    expect(ir.nodes[0].label).toBe('Line one\nLine two');
  });

  it('imports a subgraph as a group containing its nodes', () => {
    const { ir } = importMermaid(`flowchart TD
      subgraph one
        a --> b
      end`);
    expect(idsOf(ir!)).toEqual(['a', 'b']);
    expect(ir!.groups).toHaveLength(1);
    expect(ir!.groups[0].id).toBe('one');
    expect(ir!.groups[0].label).toBe('one');
    expect(ir!.groups[0].childNodeIds).toEqual(['a', 'b']);
  });

  it('uses the bracketed title as the group label when given an explicit id', () => {
    const { ir } = importMermaid(`flowchart TD
      subgraph grp1 [My Group]
        a --> b
      end`);
    expect(ir!.groups[0].id).toBe('grp1');
    expect(ir!.groups[0].label).toBe('My Group');
  });

  it('nests subgraphs via childGroupIds', () => {
    const { ir } = importMermaid(`flowchart TD
      subgraph outer
        subgraph inner
          a --> b
        end
        c
      end`);
    expect(ir!.groups).toHaveLength(2);
    const outer = ir!.groups.find((g) => g.id === 'outer')!;
    const inner = ir!.groups.find((g) => g.id === 'inner')!;
    expect(outer.childGroupIds).toEqual(['inner']);
    expect(outer.childNodeIds).toEqual(['c']);
    expect(inner.childNodeIds).toEqual(['a', 'b']);
  });
});

describe('sequence import', () => {
  it('parses participants, actors and aliases', () => {
    const ir = irOf(`sequenceDiagram
      participant A as Alice
      actor B as Bob
      A->>B: Hello`);
    expect(ir.type).toBe(DiagramType.SEQUENCE);
    expect(ir.nodes.find((n) => n.id === 'A')!.label).toBe('Alice');
    expect(ir.nodes.find((n) => n.id === 'B')!.shape).toBe(ShapeType.ACTOR);
  });

  it('does not mistake a reply connector for part of the participant id', () => {
    // Regression: `B-->>A` once parsed as a participant literally named "B-".
    const ir = irOf(`sequenceDiagram
      A->>B: Ask
      B-->>A: Answer`);
    expect(idsOf(ir)).toEqual(['A', 'B']);
    expect(edgeOf(ir, 'B', 'A')!.style.strokeStyle).toBe(StrokeStyle.DASHED);
    expect(edgeOf(ir, 'A', 'B')!.style.strokeStyle).toBeUndefined();
  });

  it('preserves message order', () => {
    const ir = irOf(`sequenceDiagram
      A->>B: first
      B->>A: second
      A->>B: third`);
    expect(ir.edges.map((e) => e.label)).toEqual(['first', 'second', 'third']);
    expect(ir.edges.map((e) => e.data.order)).toEqual([0, 1, 2]);
  });

  it('skips block constructs without dropping their messages', () => {
    const ir = irOf(`sequenceDiagram
      loop Every minute
        A->>B: ping
      end
      alt is well
        B->>A: pong
      else is not
        B->>A: nope
      end`);
    expect(ir.edges.map((e) => e.label)).toEqual(['ping', 'pong', 'nope']);
  });
});

describe('class import', () => {
  it('collects members from both the block and colon forms', () => {
    const ir = irOf(`classDiagram
      Animal : +int age
      Animal : +isMammal()
      class Duck {
        +String beakColor
        +swim()
      }`);
    // The renderer reads compartments out of the newline-joined label, so the
    // members must live there — not only in a data bag it never consults.
    expect(ir.nodes.find((n) => n.id === 'Animal')!.label).toBe('Animal\n+int age\n+isMammal()');
    expect(ir.nodes.find((n) => n.id === 'Duck')!.label).toBe('Duck\n+String beakColor\n+swim()');
  });

  it('splits members into attribute and operation compartments', () => {
    const ir = irOf(`classDiagram
      class Duck {
        +String beakColor
        +swim()
        +quack()
      }`);
    expect(ir.nodes[0].data.compartments).toEqual({
      name: 'Duck',
      attributes: ['+String beakColor'],
      operations: ['+swim()', '+quack()'],
    });
  });

  it('leaves a memberless class labeled with just its name', () => {
    const ir = irOf('classDiagram\n Animal <|-- Duck');
    expect(ir.nodes.find((n) => n.id === 'Duck')!.label).toBe('Duck');
  });

  it('orients inheritance child -> parent regardless of source order', () => {
    // Mermaid writes the parent first; the arrowhead must land on the parent.
    const a = irOf('classDiagram\n Animal <|-- Duck');
    expect(edgeOf(a, 'Duck', 'Animal')!.data.relation).toBe('inheritance');
    const b = irOf('classDiagram\n Duck --|> Animal');
    expect(edgeOf(b, 'Duck', 'Animal')!.data.relation).toBe('inheritance');
  });

  it('distinguishes relation kinds', () => {
    const ir = irOf(`classDiagram
      A *-- B
      C o-- D
      E ..> F`);
    expect(edgeOf(ir, 'A', 'B')!.data.relation).toBe('composition');
    expect(edgeOf(ir, 'C', 'D')!.data.relation).toBe('aggregation');
    expect(edgeOf(ir, 'E', 'F')!.data.relation).toBe('dependency');
  });

  it('strips multiplicities and keeps the relation label', () => {
    const ir = irOf('classDiagram\n Duck "1" --> "*" Feather : has');
    expect(idsOf(ir)).toEqual(['Duck', 'Feather']);
    expect(edgeOf(ir, 'Duck', 'Feather')!.label).toBe('has');
  });
});

describe('ER import', () => {
  it('captures entities, attributes and cardinality', () => {
    const ir = irOf(`erDiagram
      CUSTOMER ||--o{ ORDER : places
      CUSTOMER {
        string name
        string custNumber
      }`);
    expect(ir.type).toBe(DiagramType.ER);
    // renderErEntity() builds the table from the label's lines, so attributes
    // have to be joined into it for the entity to draw as a real table.
    expect(ir.nodes.find((n) => n.id === 'CUSTOMER')!.label).toBe(
      'CUSTOMER\nstring name\nstring custNumber'
    );
    expect(ir.nodes.find((n) => n.id === 'CUSTOMER')!.data.attributes).toEqual([
      'string name',
      'string custNumber',
    ]);
    // The reserved box must match what the renderer will draw (header + rows).
    expect(ir.nodes.find((n) => n.id === 'CUSTOMER')!.size.height).toBeGreaterThan(
      ir.nodes.find((n) => n.id === 'ORDER')!.size.height
    );
    const e = edgeOf(ir, 'CUSTOMER', 'ORDER')!;
    expect(e.label).toBe('places');
    expect(e.data.sourceCardinality).toBe('||');
    expect(e.data.targetCardinality).toBe('o{');
  });

  it('handles hyphenated entity names', () => {
    expect(idsOf(irOf('erDiagram\n ORDER ||--|{ LINE-ITEM : contains'))).toEqual(['LINE-ITEM', 'ORDER']);
  });
});

describe('failure handling', () => {
  it('reports unsupported types instead of throwing, and yields no IR', () => {
    const { ir, diagnostics } = importMermaid('journey\n title Trip\n section Go\n  Walk: 5: Me');
    expect(ir).toBeUndefined();
    expect(diagnostics[0].message).toMatch(/Unsupported Mermaid diagram type: "journey"/);
  });

  it('reports an empty source', () => {
    expect(importMermaid('   \n  ').diagnostics[0].message).toMatch(/Empty/);
  });

  it('ignores YAML frontmatter and comments', () => {
    const ir = irOf(`---
title: My Flow
---
%% this is a comment
flowchart LR
  a --> b`);
    expect(idsOf(ir)).toEqual(['a', 'b']);
  });

  it('keeps the good statements when one line is malformed', () => {
    const { ir, diagnostics } = importMermaid(`sequenceDiagram
      A->>B: fine
      !!! garbage !!!
      B->>A: also fine`);
    expect(ir!.edges.map((e) => e.label)).toEqual(['fine', 'also fine']);
    expect(diagnostics).toHaveLength(1);
  });
});

describe('state diagram import', () => {
  it('imports transitions and gives each [*] its own start/end pseudostate node', () => {
    const ir = irOf(`stateDiagram-v2
      [*] --> Idle
      Idle --> Running: start
      Running --> [*]: done`);
    expect(ir.type).toBe(DiagramType.STATE);
    expect(ir.nodes.find((n) => n.id === 'Idle')).toBeTruthy();
    expect(ir.nodes.find((n) => n.id === 'Running')).toBeTruthy();
    const pseudostates = ir.nodes.filter((n) => n.shape === ShapeType.CIRCLE);
    expect(pseudostates).toHaveLength(2);
    expect(ir.edges.map((e) => e.label)).toEqual([undefined, 'start', 'done']);
  });
});

describe('gantt import', () => {
  it('imports tasks with dates encoded into the label the layout parser expects', () => {
    const ir = irOf(`gantt
      title Sprint
      section Build
      Design: 2026-01-06, 3d
      Implement: 2026-01-09, 5d`);
    expect(ir.type).toBe(DiagramType.GANTT);
    expect(ir.nodes).toHaveLength(2);
    expect(ir.nodes[0].label).toMatch(/^Design: Jan 6/);
    expect(ir.nodes[1].label).toMatch(/^Implement: Jan 9/);
  });
});

describe('pie import', () => {
  it('imports slices with the value folded into a second label line', () => {
    const ir = irOf(`pie title Pets
      "Dogs" : 386
      "Cats" : 85`);
    expect(ir.type).toBe(DiagramType.CHART_PIE);
    expect(ir.nodes).toHaveLength(2);
    expect(ir.nodes[0].label).toBe('Dogs\nDogs: 386');
    expect(ir.nodes[1].label).toBe('Cats\nCats: 85');
  });
});

describe('gitGraph import', () => {
  it('imports commits and branches, chaining parent commits via edges', () => {
    const ir = irOf(`gitGraph
      commit id: "init"
      branch feature
      checkout feature
      commit id: "add thing"
      checkout main
      merge feature`);
    expect(ir.type).toBe(DiagramType.GITGRAPH);
    expect(ir.nodes.map((n) => n.label)).toEqual([
      'main: init',
      'feature: add thing',
      'main: merge feature',
    ]);
    expect(ir.edges).toHaveLength(2);
  });
});

describe('mindmap import', () => {
  it('builds a tree from indentation depth', () => {
    const ir = irOf(`mindmap
  root((Root))
    Origins
      Long history
    Research
      On effectiveness`);
    expect(ir.type).toBe(DiagramType.MINDMAP);
    expect(ir.nodes).toHaveLength(5);
    expect(ir.nodes[0].label).toBe('Root');
    // Origins and Research are both direct children of root.
    const rootId = ir.nodes[0].id;
    const childEdges = ir.edges.filter((e) => e.sourceId === rootId);
    expect(childEdges).toHaveLength(2);
  });
});
