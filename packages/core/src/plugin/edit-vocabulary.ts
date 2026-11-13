// =============================================================================
// SelDiA — Edit Vocabulary
// =============================================================================
// Per-DiagramType metadata for the visual editor's "add node" / "add edge"
// gestures: what element kinds exist for a type, and the exact DSL statement
// template to insert for each. This is deliberately a flat data table, not a
// DiagramPlugin lifecycle hook (G2: plugin lifecycle is fixed at Types →
// Parser → Engine → Renderers → Exporters) — the editor is a consumer of the
// grammar, not a new pipeline stage, so it reads this table instead of
// growing the plugin contract.
//
// `{id}` in a template is replaced with a fresh, unused node id
// (`node1`, `node2`, ...). `{label}` is replaced with the placeholder text
// the caller wants (defaults to a per-kind name below).
// =============================================================================

import { DiagramType } from '../ir/types.js';

export interface EditVocabularyEntry {
  /** Short key for this element kind, e.g. 'task', 'person', 'entity'. */
  kind: string;
  /** Label shown in the add-node palette. */
  label: string;
  /** DSL statement template. `{id}` and `{label}` are substituted. */
  template: string;
  /** Whether this template's node accepts a manual `x`/`y` position (see
   *  `engine.ts` `manualOverride`). False for layout types that ignore it
   *  (sequence, gantt, mindmap, ...) — the editor should insert in source
   *  order for those instead of writing coordinates. */
  positionable: boolean;
}

export interface EdgeVocabularyEntry {
  /** Short key for this edge kind, e.g. 'solid', 'inheritance'. */
  kind: string;
  /** Label shown in the edge-kind picker. */
  label: string;
  /** DSL arrow/connector token(s) between `{source}` and `{target}`. */
  template: string;
}

export interface DiagramEditVocabulary {
  nodes: EditVocabularyEntry[];
  edges: EdgeVocabularyEntry[];
}

const GENERIC_FLOWCHART_VOCABULARY: DiagramEditVocabulary = {
  nodes: [
    { kind: 'rect', label: 'Rectangle', template: '{id}: [{label}]', positionable: true },
    { kind: 'rounded', label: 'Rounded', template: '{id}: ({label})', positionable: true },
    { kind: 'diamond', label: 'Decision', template: '{id}: {{label}}', positionable: true },
  ],
  edges: [{ kind: 'solid', label: 'Arrow', template: '{source} --> {target}' }],
};

const VOCABULARY: Partial<Record<DiagramType, DiagramEditVocabulary>> = {
  [DiagramType.FLOWCHART]: GENERIC_FLOWCHART_VOCABULARY,
  [DiagramType.BPMN]: {
    nodes: [
      { kind: 'event', label: 'Event', template: '{id}: ({label})', positionable: true },
      { kind: 'task', label: 'Task', template: '{id}: [{label}]', positionable: true },
      { kind: 'gateway', label: 'Gateway', template: '{id}: {{label}}', positionable: true },
    ],
    edges: [{ kind: 'solid', label: 'Flow', template: '{source} --> {target}' }],
  },
  [DiagramType.SEQUENCE]: {
    nodes: [
      { kind: 'participant', label: 'Participant', template: 'participant {id}: "{label}"', positionable: false },
      { kind: 'actor', label: 'Actor', template: 'actor {id}: "{label}"', positionable: false },
    ],
    edges: [
      { kind: 'solid', label: 'Message', template: '{source} -> {target}: Message' },
      { kind: 'dashed', label: 'Reply', template: '{source} --> {target}: Reply' },
    ],
  },
  [DiagramType.CLASS]: {
    nodes: [{ kind: 'class', label: 'Class', template: '{id}: "{label}\\n+field: type"', positionable: true }],
    edges: [{ kind: 'assoc', label: 'Association', template: '{source} -->|"1 : *"| {target}' }],
  },
  [DiagramType.ER]: {
    nodes: [{ kind: 'entity', label: 'Entity', template: '{id}: "{label}\\nid: UUID PK"', positionable: true }],
    edges: [{ kind: 'rel', label: 'Relationship', template: '{source} -->|"1 : *"| {target}' }],
  },
  [DiagramType.STATE]: {
    nodes: [{ kind: 'state', label: 'State', template: '{id}: [{label}]', positionable: true }],
    edges: [{ kind: 'transition', label: 'Transition', template: '{source} --> {target}: event' }],
  },
  [DiagramType.C4_CONTEXT]: {
    nodes: [
      { kind: 'person', label: 'Person', template: 'person {id}: "{label}" "Description"', positionable: false },
      { kind: 'system', label: 'System', template: 'system {id}: "{label}" "Description"', positionable: false },
      { kind: 'system_ext', label: 'External System', template: 'system_Ext {id}: "{label}" "Description"', positionable: false },
    ],
    edges: [{ kind: 'solid', label: 'Uses', template: '{source} --> {target}: "Uses"' }],
  },
  [DiagramType.C4_CONTAINER]: {
    nodes: [
      { kind: 'container', label: 'Container', template: 'container {id}: "{label}" "Tech" "Description"', positionable: false },
      // NOT 'containerDb': the parser's SHAPE_KEYWORDS/isShapeKeyword only
      // strips a `_Ext`/`_ext` suffix (parser.ts:411-415), so the camelCase
      // `containerDb` token used by the shipped c4-container.sld template
      // isn't recognized as a keyword at all and fails to parse. Filed as a
      // separate parser bug; the editor's own template
      // just avoids the broken form rather than emitting an add-node action
      // that always fails.
      { kind: 'container_db', label: 'Database', template: 'container {id}: "{label}" "Database" "Description"', positionable: false },
    ],
    edges: [{ kind: 'solid', label: 'Calls', template: '{source} --> {target}: "Protocol"' }],
  },
};

/** Look up the edit vocabulary for a diagram type, falling back to the
 *  generic flowchart-style vocabulary (plain `id: [Label]` node, `-->` edge)
 *  for types with no dedicated entry — safe because every type's grammar
 *  accepts that base flowchart node/edge form even if it also has richer
 *  syntax the fallback doesn't reach for. */
export function getEditVocabulary(type: DiagramType): DiagramEditVocabulary {
  return VOCABULARY[type] ?? GENERIC_FLOWCHART_VOCABULARY;
}
