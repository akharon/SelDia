// =============================================================================
// SelDiA Core — PlantUML importer tests
// =============================================================================
// PlantUML has no per-diagram header keyword, so half of what can go wrong is
// *routing* — picking the family from statements that several families share.
// These tests cover that first, then the per-family syntax that actually turns
// up in real files: quoted labels with aliases, direction hints inside arrows,
// multiplicities, containers, and the structured activity keywords.

import { describe, it, expect } from 'vitest';
import { importPlantUml, isPlantUmlSource } from '../src/index.js';
import { DiagramType } from '../src/ir/types.js';
import { ShapeType } from '../src/types/shapes.js';
import { StrokeStyle } from '../src/types/style.js';

function irOf(src: string) {
  const { ir, diagnostics } = importPlantUml(src);
  if (!ir) throw new Error(`no IR: ${diagnostics.map((d) => d.message).join('; ')}`);
  return ir;
}
const idsOf = (ir: ReturnType<typeof irOf>) => ir.nodes.map((n) => n.id).sort();
const edgeOf = (ir: ReturnType<typeof irOf>, from: string, to: string) =>
  ir.edges.find((e) => e.sourceId === from && e.targetId === to);
const labelOf = (ir: ReturnType<typeof irOf>, id: string) => ir.nodes.find((n) => n.id === id)?.label;

describe('isPlantUmlSource', () => {
  it('recognizes every @start wrapper, including ones with no importer', () => {
    expect(isPlantUmlSource('@startuml\nA -> B : hi\n@enduml')).toBe(true);
    expect(isPlantUmlSource('@startmindmap\n* Root\n@endmindmap')).toBe(true);
    expect(isPlantUmlSource('@startsalt\n{ Just a form }\n@endsalt')).toBe(true);
  });

  it('recognizes a wrapper-less body by its opening keyword', () => {
    expect(isPlantUmlSource('participant Alice\nAlice -> Bob : hi')).toBe(true);
    expect(isPlantUmlSource('class Foo')).toBe(true);
  });

  it('rejects Mermaid and SelDiA DSL', () => {
    expect(isPlantUmlSource('classDiagram\n Animal <|-- Dog')).toBe(false);
    expect(isPlantUmlSource('flowchart LR\n a-->b')).toBe(false);
    expect(isPlantUmlSource('diagram flowchart "T" {\n a: (Start)\n}')).toBe(false);
  });
});

describe('diagram-type detection', () => {
  it('routes on the winning signature, not the first shared keyword', () => {
    // `actor` appears in both sequence and use case; `database` in sequence,
    // component and deployment. Each of these must land on the family with the
    // most distinctive evidence.
    expect(irOf('@startuml\nactor User\nUser -> Web : hi\n@enduml').type).toBe(DiagramType.SEQUENCE);
    expect(irOf('@startuml\nactor User\nusecase (Buy) as UC\nUser --> UC\n@enduml').type).toBe(DiagramType.USECASE);
    expect(irOf('@startuml\nclass A\nclass B\nA <|-- B\n@enduml').type).toBe(DiagramType.CLASS);
    expect(irOf('@startuml\nstart\n:Do it;\nstop\n@enduml').type).toBe(DiagramType.ACTIVITY);
    expect(irOf('@startuml\n[*] --> Idle\nIdle --> [*]\n@enduml').type).toBe(DiagramType.STATE);
    expect(irOf('@startuml\n[A] --> [B]\n@enduml').type).toBe(DiagramType.COMPONENT);
    expect(irOf('@startuml\nnode Server\nartifact app.jar\nServer --> app.jar\n@enduml').type).toBe(DiagramType.DEPLOYMENT);
    expect(irOf('@startmindmap\n* Root\n@endmindmap').type).toBe(DiagramType.MINDMAP);
    expect(irOf('@startgantt\n[Design] lasts 3 days\n@endgantt').type).toBe(DiagramType.GANTT);
  });

  it('only calls it ER when a crow’s-foot cardinality is present', () => {
    // `entity` alone is a sequence-diagram participant shape.
    expect(irOf('@startuml\nentity Order\nUser -> Order : place\n@enduml').type).toBe(DiagramType.SEQUENCE);
    expect(irOf('@startuml\nentity A {\n x : int\n}\nentity B\nA ||--o{ B\n@enduml').type).toBe(DiagramType.ER);
  });

  it('reports unsupported blocks instead of guessing', () => {
    const { ir, diagnostics } = importPlantUml('@startjson\n{ "a": 1 }\n@endjson');
    expect(ir).toBeUndefined();
    expect(diagnostics[0].message).toMatch(/@startjson/);
  });
});

describe('preprocessing', () => {
  it('strips comments, directives and notes but keeps the title', () => {
    const ir = irOf(`@startuml
' a line comment
/' a block
   comment '/
!theme spacelab
skinparam monochrome true
skinparam sequence {
  ArrowColor red
}
title My Flow
hide footbox
note left of A : this note is not a node
note over A, B
  multi-line body
end note
A -> B : go
@enduml`);
    expect(ir.title).toBe('My Flow');
    expect(idsOf(ir)).toEqual(['A', 'B']);
    expect(ir.edges).toHaveLength(1);
  });

  it('lifts the layout direction out of `left to right direction`', () => {
    const ir = irOf('@startuml\nleft to right direction\nactor A\nusecase (B)\nA --> B\n@enduml');
    expect(ir.metadata.direction).toBe('LR');
  });
});

describe('sequence import', () => {
  const ir = irOf(`@startuml
actor User
participant "Web App" as web
database DB
control Scheduler
User -> web : login
web -> DB : query
DB --> web : rows
alt success
  web --> User : page
else failure
  web --> User : error
end
@enduml`);

  it('maps each participant keyword to its lifeline shape', () => {
    expect(ir.nodes.find((n) => n.id === 'User')!.shape).toBe(ShapeType.ACTOR);
    expect(ir.nodes.find((n) => n.id === 'DB')!.shape).toBe(ShapeType.CYLINDER);
    expect(ir.nodes.find((n) => n.id === 'Scheduler')!.shape).toBe(ShapeType.CIRCLE);
    expect(labelOf(ir, 'web')).toBe('Web App');
  });

  it('treats a two-dash run as the dotted reply, not as a solid line', () => {
    // `-->` is a *reply* in PlantUML sequence syntax even though the same
    // token is a solid association in a class diagram.
    expect(edgeOf(ir, 'User', 'web')!.style.strokeStyle).toBeUndefined();
    expect(edgeOf(ir, 'DB', 'web')!.style.strokeStyle).toBe(StrokeStyle.DASHED);
  });

  it('records alt/else as a fragment span the sequence layout can draw', () => {
    const frags = ir.metadata.sequenceFragments as any[];
    expect(frags).toHaveLength(1);
    expect(frags[0].keyword).toBe('alt');
    expect(frags[0].sections.map((s: any) => s.label)).toEqual(['success', 'failure']);
    expect(frags[0].lastEdge - frags[0].firstEdge).toBe(2);
  });

  it('reverses a right-to-left arrow so the message runs the way it reads', () => {
    const rev = irOf('@startuml\nA <- B : answer\n@enduml');
    expect(edgeOf(rev, 'B', 'A')).toBeDefined();
  });
});

describe('class import', () => {
  const ir = irOf(`@startuml
abstract class Animal {
  +String name
  -int age
  +void speak()
}
interface Flyer
enum Color {
  RED
  GREEN
}
class Dog
Animal <|-- Dog
Dog ..|> Flyer
Animal "1" *-- "many" Leg : has
Dog -down-> Bone : chews
package Zoo {
  class Keeper
}
@enduml`);

  it('folds members into the label the class renderer actually reads', () => {
    expect(labelOf(ir, 'Animal')).toBe('«abstract» Animal\n+String name\n-int age\n+void speak()');
    const compartments = ir.nodes.find((n) => n.id === 'Animal')!.data.compartments as any;
    expect(compartments.attributes).toEqual(['+String name', '-int age']);
    expect(compartments.operations).toEqual(['+void speak()']);
  });

  it('spells the element kind as a stereotype on the name line', () => {
    expect(labelOf(ir, 'Flyer')).toBe('«interface» Flyer');
    expect(labelOf(ir, 'Color')).toBe('«enumeration» Color\nRED\nGREEN');
  });

  it('points every decorated relation at the decorated end', () => {
    // The arrowhead is drawn at the target, so the parent/whole must be there.
    expect(edgeOf(ir, 'Dog', 'Animal')!.data.relation).toBe('inheritance');
    expect(edgeOf(ir, 'Dog', 'Animal')!.data.arrowType).toBe('generalization');
    expect(edgeOf(ir, 'Dog', 'Flyer')!.data.relation).toBe('realization');
    expect(edgeOf(ir, 'Leg', 'Animal')!.data.relation).toBe('composition');
  });

  it('carries multiplicities onto the end they belong to', () => {
    const e = edgeOf(ir, 'Leg', 'Animal')!;
    expect(e.data.sourceMultiplicity).toBe('many');
    expect(e.data.targetMultiplicity).toBe('1');
    expect(e.label).toBe('has');
  });

  it('reads through a direction hint inside the arrow', () => {
    expect(edgeOf(ir, 'Dog', 'Bone')!.label).toBe('chews');
  });

  it('turns a package into a group holding its members', () => {
    const zoo = ir.groups.find((g) => g.label === 'Zoo')!;
    expect(zoo.childNodeIds).toEqual(['Keeper']);
  });

  it('keeps a quoted multiplicity from being read as a dotted connector', () => {
    const dotted = irOf('@startuml\nclass A\nclass B\nA "0..*" -- "1" B\n@enduml');
    expect(dotted.edges).toHaveLength(1);
    expect(idsOf(dotted)).toEqual(['A', 'B']);
  });
});

describe('ER import', () => {
  const ir = irOf(`@startuml
entity Customer {
  * id : number
  --
  name : text
}
entity Order {
  * id : number
}
Customer ||--o{ Order : places
@enduml`);

  // PlantUML's leading `*` marks an attribute mandatory (NOT NULL). The IR has
  // no nullability field, and every downstream reader takes the first token as
  // the column name -- sql-ddl's parseAttr() would emit a column called `_` --
  // so the marker is dropped at import rather than carried as dead text.
  it('builds the entity table out of the newline-joined label', () => {
    expect(labelOf(ir, 'Customer')).toBe('Customer\nid : number\nname : text');
    expect(ir.nodes.find((n) => n.id === 'Customer')!.data.attributes).toEqual(['id : number', 'name : text']);
  });

  it('keeps both crow’s-foot cardinalities', () => {
    const e = edgeOf(ir, 'Customer', 'Order')!;
    expect(e.data.sourceCardinality).toBe('||');
    expect(e.data.targetCardinality).toBe('o{');
    expect(e.label).toBe('places');
  });
});

describe('use case import', () => {
  const ir = irOf(`@startuml
left to right direction
actor Customer
:Admin: as adm
rectangle Shop {
  (Browse) as UC1
  usecase "Check out" as UC2
}
Customer --> UC1
adm --> UC2 : manages
@enduml`);

  it('classifies actors and use cases from their own delimiters', () => {
    expect(ir.nodes.find((n) => n.id === 'Customer')!.data.usecaseKind).toBe('actor');
    expect(ir.nodes.find((n) => n.id === 'adm')!.data.usecaseKind).toBe('actor');
    expect(ir.nodes.find((n) => n.id === 'UC1')!.data.usecaseKind).toBe('usecase');
    expect(labelOf(ir, 'UC2')).toBe('Check out');
  });

  it('nests the rectangle’s contents in a group', () => {
    expect(ir.groups[0].childNodeIds.sort()).toEqual(['UC1', 'UC2']);
  });
});

describe('activity import', () => {
  const ir = irOf(`@startuml
start
:Read request;
if (valid?) then (yes)
  :Process;
else (no)
  :Reject;
endif
while (more items?) is (yes)
  :Next item;
endwhile
:Save;
stop
@enduml`);
  const byLabel = (label: string) => ir.nodes.find((n) => n.data.activityLabel === label)!;

  it('reads the condition without swallowing the then-clause', () => {
    expect(byLabel('valid?')).toBeDefined();
    expect(byLabel('valid?').data.activityKind).toBe('decision');
    expect(byLabel('more items?').data.activityKind).toBe('decision');
  });

  it('wires both branches of an if and merges them after endif', () => {
    const decision = byLabel('valid?').id;
    expect(edgeOf(ir, decision, byLabel('Process').id)!.label).toBe('yes');
    expect(edgeOf(ir, decision, byLabel('Reject').id)!.label).toBe('no');
    const loopHead = byLabel('more items?').id;
    expect(edgeOf(ir, byLabel('Process').id, loopHead)).toBeDefined();
    expect(edgeOf(ir, byLabel('Reject').id, loopHead)).toBeDefined();
  });

  it('loops the while body back into its condition', () => {
    const loopHead = byLabel('more items?').id;
    expect(edgeOf(ir, loopHead, byLabel('Next item').id)!.label).toBe('yes');
    expect(edgeOf(ir, byLabel('Next item').id, loopHead)).toBeDefined();
    expect(edgeOf(ir, loopHead, byLabel('Save').id)!.label).toBe('no');
  });

  it('gives start and end their own empty circle nodes', () => {
    const kinds = ir.nodes.map((n) => n.data.activityKind);
    expect(kinds).toContain('start');
    expect(kinds).toContain('end');
    expect(ir.nodes.filter((n) => n.data.activityKind === 'start')[0].shape).toBe(ShapeType.CIRCLE);
  });

  it('keeps an if with no else from losing its second exit', () => {
    const noElse = irOf('@startuml\nstart\nif (ok?) then (yes)\n:A;\nendif\n:B;\nstop\n@enduml');
    const decision = noElse.nodes.find((n) => n.data.activityKind === 'decision')!.id;
    const b = noElse.nodes.find((n) => n.data.activityLabel === 'B')!.id;
    expect(edgeOf(noElse, decision, b)).toBeDefined();
  });

  it('also understands the legacy `(*) -->` form', () => {
    const legacy = irOf('@startuml\n(*) --> "First"\n"First" -->[ok] "Second"\n"Second" --> (*)\n@enduml');
    expect(legacy.type).toBe(DiagramType.ACTIVITY);
    const first = legacy.nodes.find((n) => n.data.activityLabel === 'First')!;
    const second = legacy.nodes.find((n) => n.data.activityLabel === 'Second')!;
    expect(edgeOf(legacy, first.id, second.id)!.label).toBe('ok');
  });
});

describe('component import', () => {
  const ir = irOf(`@startuml
package "Frontend" {
  [Web UI] as ui
}
component "API Gateway" as gw
database "Postgres" as pg
() "REST" as rest
ui --> rest
rest ..> gw
gw --> pg : SQL
@enduml`);

  it('maps the declaration keyword straight onto the component kind', () => {
    expect(ir.nodes.find((n) => n.id === 'rest')!.data.componentKind).toBe('interface');
    expect(ir.nodes.find((n) => n.id === 'pg')!.data.componentKind).toBe('datastore');
    expect(ir.nodes.find((n) => n.id === 'gw')!.data.componentKind).toBe('service');
    expect(ir.nodes.find((n) => n.id === 'ui')!.data.componentKind).toBe('component');
  });

  it('marks a dotted connector dashed', () => {
    expect(edgeOf(ir, 'rest', 'gw')!.style.strokeStyle).toBe(StrokeStyle.DASHED);
    expect(edgeOf(ir, 'gw', 'pg')!.style.strokeStyle).toBeUndefined();
  });
});

describe('deployment import', () => {
  const ir = irOf(`@startuml
node "App Server" as app {
  artifact "app.jar" as jar
}
node "DB Host" as dbh {
  database "Postgres" as pg
}
device "Phone" as ph
ph --> app : HTTPS
app --> pg
@enduml`);

  it('redirects a relation aimed at a container onto its contents', () => {
    // `app` is a group, and an IR edge can only land on a node — left alone the
    // reference would manufacture an empty box beside the group it meant.
    expect(idsOf(ir)).toEqual(['jar', 'pg', 'ph']);
    const e = edgeOf(ir, 'ph', 'jar')!;
    expect(e.label).toBe('HTTPS');
    expect(e.data.targetContainer).toBe('grp-app');
  });

  it('keeps the container as a group with its real label', () => {
    expect(ir.groups.map((g) => g.label).sort()).toEqual(['App Server', 'DB Host']);
  });

  it('maps keywords onto deployment kinds', () => {
    expect(ir.nodes.find((n) => n.id === 'jar')!.data.deploymentKind).toBe('artifact');
    expect(ir.nodes.find((n) => n.id === 'ph')!.data.deploymentKind).toBe('device');
  });
});

describe('state import', () => {
  const ir = irOf(`@startuml
[*] --> Idle
Idle --> Running : start
state Running {
  [*] --> Working
  Working --> Waiting : block
}
Idle : entry / reset timer
Idle --> [*]
@enduml`);

  it('gives every [*] its own pseudostate node', () => {
    // One shared node would wire together transitions that were never connected.
    expect(ir.nodes.filter((n) => n.id.startsWith('__start_'))).toHaveLength(2);
    expect(ir.nodes.filter((n) => n.id.startsWith('__end_'))).toHaveLength(1);
  });

  it('models a composite state as a group over its substates', () => {
    const running = ir.groups.find((g) => g.label === 'Running')!;
    expect(running.childNodeIds).toContain('Working');
    expect(running.childNodeIds).toContain('Waiting');
  });

  it('prefers a real substate over the entry pseudostate when redirecting', () => {
    // Redirecting `Idle --> Running` onto the composite's `[*]` would export
    // back as `Idle --> [*]`, silently rewriting the transition.
    expect(edgeOf(ir, 'Idle', 'Working')!.label).toBe('start');
  });

  it('appends an internal action to the state’s label', () => {
    expect(labelOf(ir, 'Idle')).toBe('Idle\nentry / reset timer');
  });
});

describe('mindmap import', () => {
  it('derives depth from marker repetition and side from the marker itself', () => {
    const ir = irOf(`@startmindmap
* Root
** Child A
*** Leaf
** Child B
-- Left branch
@endmindmap`);
    expect(ir.nodes.map((n) => n.label)).toEqual(['Root', 'Child A', 'Leaf', 'Child B', 'Left branch']);
    expect(ir.nodes[4].data.side).toBe('left');
    // Leaf hangs off Child A; both Child B and the left branch hang off Root.
    expect(edgeOf(ir, ir.nodes[1].id, ir.nodes[2].id)).toBeDefined();
    expect(edgeOf(ir, ir.nodes[0].id, ir.nodes[3].id)).toBeDefined();
    expect(edgeOf(ir, ir.nodes[0].id, ir.nodes[4].id)).toBeDefined();
  });

  it('reads a multi-line node and the boxless marker', () => {
    const ir = irOf('@startmindmap\n* Root\n**_ plain\n**:first\nsecond;\n@endmindmap');
    expect(ir.nodes[1].shape).toBe(ShapeType.NONE);
    expect(ir.nodes[2].label).toBe('first\nsecond');
  });

  it('imports a WBS with the same grammar', () => {
    const ir = irOf('@startwbs\n* Project\n** Phase 1\n@endwbs');
    expect(ir.type).toBe(DiagramType.MINDMAP);
    expect(ir.nodes).toHaveLength(2);
  });
});

describe('gantt import', () => {
  const ir = irOf(`@startgantt
project starts 2026-01-05
[Design] lasts 10 days
[Build] lasts 20 days
[Build] starts at [Design]'s end
[Launch] happens at [Build]'s end
@endgantt`);

  it('resolves relative scheduling against the project start', () => {
    expect(ir.nodes[0].data.startDate).toBe('2026-01-05');
    expect(ir.nodes[1].data.startDate).toBe('2026-01-15');
    expect(ir.nodes[2].data.startDate).toBe('2026-02-04');
    expect(ir.nodes[2].data.milestone).toBe(true);
  });

  it('emits the label vocabulary the gantt layout parses', () => {
    // Same-month ranges use "Mon D-D2"; a range that crosses a month boundary
    // has to spell the second month out or the end day is read against the first.
    expect(ir.nodes[0].label).toBe('Design: Jan 5-15');
    expect(ir.nodes[1].label).toBe('Build: Jan 15 - Feb 4');
    expect(ir.nodes[2].label).toBe('Launch: Feb 4');
  });
});

describe('resilience', () => {
  it('reports a bad statement and keeps the rest of the diagram', () => {
    const { ir, diagnostics } = importPlantUml('@startuml\nclass A\n?!?!\nclass B\nA <|-- B\n@enduml');
    expect(ir!.nodes).toHaveLength(2);
    expect(ir!.edges).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].line).toBe(3);
  });

  it('never throws on garbage', () => {
    for (const src of ['', '@startuml\n@enduml', '@startuml\n-->\n@enduml', '{{{', '@startuml\n"""\n@enduml']) {
      expect(() => importPlantUml(src)).not.toThrow();
    }
  });
});
