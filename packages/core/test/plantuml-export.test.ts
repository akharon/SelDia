// =============================================================================
// SelDiA Core — PlantUML exporter tests
// =============================================================================
// Two things have to hold. First, the emitted text is *syntactically* what
// PlantUML expects — the spellings that are easy to get subtly wrong
// (multiplicity placement, composite states needing an alias, legacy activity
// labels living inside the arrow) get their own assertions. Second, importing
// what we emitted reproduces the structure we started from, which is the only
// check that covers the two files agreeing with each other.

import { describe, it, expect } from 'vitest';
import { importPlantUml, exportPlantUml, isPlantUmlExportable } from '../src/index.js';
import { DiagramType, type DiagramIR } from '../src/ir/types.js';

function roundTrip(src: string): { first: DiagramIR; text: string; second: DiagramIR } {
  const { ir } = importPlantUml(src);
  if (!ir) throw new Error('import produced no IR');
  const text = exportPlantUml(ir);
  if (text === null) throw new Error(`no exporter for ${ir.type}`);
  const back = importPlantUml(text);
  if (!back.ir) throw new Error(`re-import failed: ${back.diagnostics.map((d) => d.message).join('; ')}`);
  return { first: ir, text, second: back.ir };
}

/** Structure that must survive a round trip, independent of generated ids. */
const shapeOf = (ir: DiagramIR) => ({
  type: ir.type,
  nodes: ir.nodes.length,
  edges: ir.edges.length,
  groups: ir.groups.length,
});

describe('isPlantUmlExportable', () => {
  it('covers every imported family, plus flowchart', () => {
    for (const t of [
      DiagramType.FLOWCHART, DiagramType.SEQUENCE, DiagramType.CLASS, DiagramType.ER,
      DiagramType.STATE, DiagramType.USECASE, DiagramType.ACTIVITY, DiagramType.COMPONENT,
      DiagramType.DEPLOYMENT, DiagramType.MINDMAP, DiagramType.GANTT,
    ]) expect(isPlantUmlExportable(t)).toBe(true);
  });

  it('declines a type with no PlantUML spelling rather than inventing one', () => {
    expect(isPlantUmlExportable(DiagramType.GITGRAPH)).toBe(false);
    expect(isPlantUmlExportable(DiagramType.CHART_PIE)).toBe(false);
    expect(exportPlantUml({
      id: 'x', type: DiagramType.WIREFRAME, nodes: [], edges: [], groups: [], layers: [], metadata: {},
    })).toBeNull();
  });
});

describe('envelope', () => {
  it('wraps in @startuml/@enduml and carries the title', () => {
    const { text } = roundTrip('@startuml\ntitle Login\nA -> B : hi\n@enduml');
    expect(text.split('\n')[0]).toBe('@startuml');
    expect(text).toContain('title Login');
    expect(text.trimEnd().endsWith('@enduml')).toBe(true);
  });

  it('uses the matching wrapper for mindmap and gantt', () => {
    expect(roundTrip('@startmindmap\n* Root\n** Leaf\n@endmindmap').text).toContain('@startmindmap');
    expect(roundTrip('@startgantt\n[Design] lasts 3 days\n@endgantt').text).toContain('@startgantt');
  });
});

describe('sequence export', () => {
  const { text, first, second } = roundTrip(`@startuml
actor User
participant "Web App" as web
database DB
User -> web : login
web -> DB : query
DB --> web : rows
alt success
  web --> User : page
else failure
  web --> User : error
end
@enduml`);

  it('re-declares each participant with its keyword and quoted label', () => {
    expect(text).toContain('actor User');
    expect(text).toContain('participant "Web App" as web');
    expect(text).toContain('database DB');
  });

  it('writes a dashed message back as the dotted reply arrow', () => {
    expect(text).toContain('User -> web : login');
    expect(text).toContain('DB --> web : rows');
  });

  it('replays fragments as alt/else/end around the right messages', () => {
    const lines = text.split('\n');
    expect(lines.filter((l) => l.startsWith('alt'))).toEqual(['alt success']);
    expect(lines.filter((l) => l.startsWith('else'))).toEqual(['else failure']);
    expect(lines.filter((l) => l === 'end')).toHaveLength(1);
    expect(lines.indexOf('alt success')).toBeLessThan(lines.findIndex((l) => l.includes(': page')));
    expect(lines.indexOf('end')).toBeGreaterThan(lines.findIndex((l) => l.includes(': error')));
  });

  it('round-trips the structure', () => {
    expect(shapeOf(second)).toEqual(shapeOf(first));
    expect((second.metadata.sequenceFragments as any[])[0].keyword).toBe('alt');
  });
});

describe('class export', () => {
  const { text, first, second } = roundTrip(`@startuml
abstract class Animal {
  +String name
  +void speak()
}
interface Flyer
class Dog
Animal <|-- Dog
Dog ..|> Flyer
Animal "1" *-- "many" Leg : has
package Zoo {
  class Keeper
}
@enduml`);

  it('recovers the element kind from the stereotype line', () => {
    expect(text).toContain('abstract class Animal {');
    expect(text).toContain('interface Flyer');
  });

  it('writes each multiplicity between its element and the arrow', () => {
    // `"1" Animal *-- Leg "many"` is not valid PlantUML — the quotes have to
    // sit on the inside, next to the connector.
    expect(text).toContain('Animal "1" *-- "many" Leg : has');
  });

  it('writes decorated relations target-first, so the arrowhead lands right', () => {
    expect(text).toContain('Animal <|-- Dog');
    expect(text).toContain('Flyer <|.. Dog');
  });

  it('round-trips structure, members and relation kinds', () => {
    expect(shapeOf(second)).toEqual(shapeOf(first));
    const animal = second.nodes.find((n) => n.label.startsWith('«abstract» Animal'))!;
    expect((animal.data.compartments as any).operations).toEqual(['+void speak()']);
    expect(second.edges.map((e) => e.data.relation).sort())
      .toEqual(['composition', 'inheritance', 'realization']);
  });
});

describe('state export', () => {
  const { text, second } = roundTrip(`@startuml
[*] --> Idle
Idle --> Running : start
state Running {
  [*] --> Working
  Working --> Waiting : block
}
Idle --> [*]
@enduml`);

  it('gives a composite state an alias, which PlantUML requires with a body', () => {
    expect(text).toMatch(/state "Running" as \w+ \{/);
  });

  it('collapses every pseudostate node back onto [*]', () => {
    expect(text).toContain('[*] --> Idle');
    expect(text).toContain('Idle --> [*]');
    expect(text).not.toMatch(/__start_|__end_/);
  });

  it('re-imports without inventing extra states', () => {
    expect(second.nodes.filter((n) => !n.id.startsWith('__')).map((n) => n.id).sort())
      .toEqual(['Idle', 'Waiting', 'Working']);
  });
});

describe('activity export', () => {
  const { text, first, second } = roundTrip(`@startuml
start
:Read request;
if (valid?) then (yes)
  :Process;
else (no)
  :Reject;
endif
:Save;
stop
@enduml`);

  it('emits the graph-shaped legacy form rather than guessing control flow', () => {
    // Re-inferring if/else from an arbitrary IR graph is not possible in
    // general; the legacy syntax is graph-native, so nothing is reordered.
    expect(text).toContain('(*) --> "Read request"');
    expect(text).toContain('"Save" --> (*)');
  });

  it('puts an edge label inside the arrow, where legacy syntax expects it', () => {
    expect(text).toContain('"valid?" -->[yes] "Process"');
    expect(text).toContain('"valid?" -->[no] "Reject"');
  });

  it('round-trips node and edge counts', () => {
    expect(shapeOf(second)).toEqual(shapeOf(first));
  });
});

describe('component and deployment export', () => {
  it('re-declares components with the keyword their kind implies', () => {
    const { text, first, second } = roundTrip(`@startuml
package "Frontend" {
  [Web UI] as ui
}
component "API Gateway" as gw
database "Postgres" as pg
() "REST" as rest
ui --> rest
gw --> pg : SQL
@enduml`);
    expect(text).toContain('package "Frontend" {');
    expect(text).toContain('interface "REST" as rest');
    expect(text).toContain('database "Postgres" as pg');
    expect(shapeOf(second)).toEqual(shapeOf(first));
  });

  it('keeps deployment containers as nodes with their contents nested', () => {
    const { text, second } = roundTrip(`@startuml
node "App Server" as app {
  artifact "app.jar" as jar
}
device "Phone" as ph
ph --> app : HTTPS
@enduml`);
    expect(text).toContain('node "App Server" {');
    expect(text).toContain('artifact "app.jar" as jar');
    expect(second.groups).toHaveLength(1);
  });
});

describe('ER, use case, mindmap and gantt export', () => {
  it('writes entity tables and crow’s-foot cardinalities', () => {
    const { text, first, second } = roundTrip(`@startuml
entity Customer {
  * id : number
  name : text
}
entity Order {
  * id : number
}
Customer ||--o{ Order : places
@enduml`);
    expect(text).toContain('entity Customer {');
    expect(text).toContain('Customer ||--o{ Order : places');
    expect(shapeOf(second)).toEqual(shapeOf(first));
  });

  it('writes actors and use cases with a left-to-right hint', () => {
    const { text, first, second } = roundTrip(`@startuml
left to right direction
actor Customer
usecase (Browse) as UC1
Customer --> UC1
@enduml`);
    expect(text).toContain('left to right direction');
    expect(text).toContain('actor Customer');
    expect(text).toContain('usecase "Browse" as UC1');
    expect(shapeOf(second)).toEqual(shapeOf(first));
  });

  it('rebuilds the mindmap outline, including left-side markers', () => {
    const { text, first, second } = roundTrip('@startmindmap\n* Root\n** Child\n*** Leaf\n-- Left\n@endmindmap');
    expect(text).toContain('* Root');
    expect(text).toContain('*** Leaf');
    expect(text).toContain('-- Left');
    expect(shapeOf(second)).toEqual(shapeOf(first));
  });

  it('rebuilds gantt tasks as absolute dates', () => {
    const { text, second } = roundTrip(`@startgantt
project starts 2026-01-05
[Design] lasts 10 days
[Build] starts at [Design]'s end
[Build] lasts 20 days
@endgantt`);
    expect(text).toContain('project starts 2026-01-05');
    expect(text).toContain('[Design] starts 2026-01-05');
    expect(text).toContain('[Design] lasts 10 days');
    expect(second.nodes[1].data.startDate).toBe('2026-01-15');
  });
});

describe('flowchart export', () => {
  it('lands a flowchart IR on rectangles and arrows', () => {
    // Flowchart has no PlantUML family of its own, so this is the one exporter
    // with no importer counterpart to agree with — it just has to be valid.
    const ir: DiagramIR = {
      id: 'f', type: DiagramType.FLOWCHART, title: 'Flow',
      nodes: [
        { id: 'a', label: 'Start', shape: 'rounded-rectangle' as any, position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, style: {}, ports: [], classList: [], collapsed: false, data: {} },
        { id: 'b', label: 'Store it', shape: 'cylinder' as any, position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, style: {}, ports: [], classList: [], collapsed: false, data: {} },
      ],
      edges: [{ id: 'e', sourceId: 'a', targetId: 'b', label: 'then', style: {}, routing: 'orthogonal' as any, bidirectional: false, classList: [], data: {} }],
      groups: [], layers: [], metadata: { direction: 'LR' },
    };
    const text = exportPlantUml(ir)!;
    expect(text).toContain('left to right direction');
    expect(text).toContain('database "Store it" as b');
    expect(text).toContain('a --> b : then');
    expect(importPlantUml(text).ir!.edges).toHaveLength(1);
  });
});
