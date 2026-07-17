// =============================================================================
// SelDiA — Mermaid Export Tests
// =============================================================================
// Round-trip focused: import real Mermaid, export it back, re-import the
// export, and check the structure survived — this is a stronger signal than
// asserting exact output text, since Mermaid has many valid spellings for the
// same structure.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { importMermaid } from '../src/import/mermaid.js';
import { exportMermaid, isMermaidExportable } from '../src/export/mermaid.js';
import { DiagramType } from '../src/ir/types.js';

function roundTrip(source: string) {
  const first = importMermaid(source);
  expect(first.ir).toBeDefined();
  const text = exportMermaid(first.ir!);
  expect(text).toBeTruthy();
  const second = importMermaid(text!);
  expect(second.ir).toBeDefined();
  return { first: first.ir!, second: second.ir!, text: text! };
}

describe('isMermaidExportable', () => {
  it('reports true for covered types and false for others', () => {
    expect(isMermaidExportable(DiagramType.FLOWCHART)).toBe(true);
    expect(isMermaidExportable(DiagramType.MINDMAP)).toBe(true);
    expect(isMermaidExportable(DiagramType.SANKEY)).toBe(false);
  });
});

describe('flowchart export', () => {
  it('round-trips nodes, edges, and shapes', () => {
    const { first, second } = roundTrip(`flowchart TD
      a[Start] --> b{Decision}
      b -->|yes| c((Done))`);
    expect(second.nodes).toHaveLength(first.nodes.length);
    expect(second.edges).toHaveLength(first.edges.length);
    const c = second.nodes.find((n) => n.label === 'Done');
    expect(c?.shape).toBe(first.nodes.find((n) => n.label === 'Done')!.shape);
  });

  it('round-trips style directives', () => {
    const { first, second, text } = roundTrip(`flowchart TD
      a --> b
      style a fill:#f9f,stroke:#333,stroke-width:2px`);
    expect(text).toContain('style');
    const a2 = second.nodes.find((n) => n.id === first.nodes[0].id) || second.nodes[0];
    expect(a2.style.fill).toBe('#f9f');
    expect(a2.style.stroke).toBe('#333');
  });

  it('round-trips subgraphs as groups', () => {
    const { first, second } = roundTrip(`flowchart TD
      subgraph grp1 [My Group]
        a --> b
      end`);
    expect(second.groups).toHaveLength(first.groups.length);
    expect(second.groups[0].label).toBe('My Group');
  });
});

describe('sequence export', () => {
  it('round-trips participants and messages', () => {
    const { first, second } = roundTrip(`sequenceDiagram
      participant A as Alice
      actor B as Bob
      A->>B: Hello`);
    expect(second.nodes).toHaveLength(first.nodes.length);
    expect(second.edges).toHaveLength(1);
    expect(second.edges[0].label).toBe('Hello');
  });
});

describe('class export', () => {
  it('round-trips class members and relations', () => {
    const { second } = roundTrip(`classDiagram
      class Animal {
        +String name
        +makeSound()
      }
      Animal <|-- Dog`);
    const animal = second.nodes.find((n) => n.label.startsWith('Animal'));
    expect(animal).toBeDefined();
    expect(animal!.label).toContain('name');
    expect(animal!.label).toContain('makeSound()');
    expect(second.edges).toHaveLength(1);
  });
});

describe('ER export', () => {
  it('round-trips entities and cardinality', () => {
    const { second } = roundTrip(`erDiagram
      CUSTOMER {
        string name
      }
      CUSTOMER ||--o{ ORDER : places`);
    expect(second.nodes.some((n) => n.id === 'CUSTOMER')).toBe(true);
    expect(second.edges).toHaveLength(1);
    expect(second.edges[0].label).toBe('places');
  });
});

describe('state export', () => {
  it('round-trips transitions including pseudostates', () => {
    const { second } = roundTrip(`stateDiagram-v2
      [*] --> Idle
      Idle --> Running : start
      Running --> [*] : done`);
    expect(second.edges).toHaveLength(3);
    expect(second.edges.map((e) => e.label)).toEqual([undefined, 'start', 'done']);
  });
});

describe('gantt export', () => {
  it('round-trips task titles', () => {
    const { second } = roundTrip(`gantt
      title Project
      dateFormat YYYY-MM-DD
      Design : 2026-01-06, 2026-01-09
      Build : 2026-01-09, 2026-01-13`);
    expect(second.nodes).toHaveLength(2);
    expect(second.nodes[0].label).toContain('Design');
  });
});

describe('pie export', () => {
  it('round-trips category values', () => {
    const { second } = roundTrip(`pie title Pets
      "Dogs" : 386
      "Cats" : 85`);
    expect(second.nodes).toHaveLength(2);
    expect(second.nodes[0].label).toContain('Dogs');
    expect(second.nodes[0].label).toContain('386');
  });
});

describe('gitGraph export', () => {
  it('round-trips branch and commit structure', () => {
    const { second } = roundTrip(`gitGraph
      commit id: "init"
      branch feature
      commit id: "add thing"
      checkout main
      merge feature`);
    expect(second.nodes.length).toBeGreaterThanOrEqual(3);
  });
});

describe('mindmap export', () => {
  it('round-trips tree structure', () => {
    const { first, second } = roundTrip(`mindmap
      root((Root))
        Child1
          Grandchild
        Child2`);
    expect(second.nodes).toHaveLength(first.nodes.length);
    expect(second.edges).toHaveLength(first.edges.length);
  });
});

describe('unsupported types', () => {
  it('returns null rather than throwing', () => {
    const ir = importMermaid('flowchart TD\n a --> b').ir!;
    const fakeSankey = { ...ir, type: DiagramType.SANKEY };
    expect(exportMermaid(fakeSankey)).toBeNull();
  });
});
