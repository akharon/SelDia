// =============================================================================
// SelDiA — Work-Item Schema
// =============================================================================
// The vocabulary for documentation / work-item diagrams: requirements, design
// decisions, tests, capabilities, features, stories, and risks, each carrying
// its own sections, linked by typed relationships.
//
// Both vocabularies here are DELIBERATELY CLOSED. An open-ended item type
// (`anything: "My Thing"`) would make the diagram unvalidatable — nothing could
// say a link is wrong, which is the whole point of modelling traceability
// rather than drawing boxes. A closed set is what lets `verifies` reject a
// requirement→feature edge and lets coverage be computed at all. Adding a type
// is a deliberate edit here, not something a document can do to itself.
//
// Sections are per-type on purpose: a decision has a rationale and a status, an
// estimate would be meaningless on it; a story has points and dates, a
// rationale would not be. Declaring the intersection of every field on every
// type is what turns a schema into a shapeless bag.
// =============================================================================

/** The closed set of work-item types. */
export type WorkItemType =
  | 'requirement' | 'decision' | 'test' | 'capability'
  | 'feature' | 'story' | 'risk';

/** The closed set of link kinds between items. */
export type WorkItemLink =
  | 'refines'    // child requirement narrows a parent
  | 'satisfies'  // a feature/story fulfils a requirement or capability
  | 'verifies'   // a test proves a requirement/feature is met
  | 'derives'    // an item was derived from another
  | 'decides'    // a decision resolves/affects an item
  | 'conflicts'  // two items are mutually incompatible
  | 'mitigates'  // something reduces a risk
  | 'depends';   // ordering / blocking dependency

/** A section is one labelled field on an item. `long` fields wrap across
 *  several lines in the rendered card; `short` fields sit on one line. */
export interface SectionSpec {
  key: string;
  label: string;
  form: 'short' | 'long';
}

const S = (key: string, label: string, form: 'short' | 'long' = 'short'): SectionSpec => ({ key, label, form });

/** Sections common to every item type. Kept minimal — anything only some types
 *  need belongs in that type's own list, not here. */
const COMMON: SectionSpec[] = [
  S('description', 'Description', 'long'),
  S('status', 'Status'),
  S('owner', 'Owner'),
];

/** Per-type sections, in render order, appended after COMMON. */
export const ITEM_SECTIONS: Record<WorkItemType, SectionSpec[]> = {
  requirement: [S('justification', 'Justification', 'long'), S('priority', 'Priority'), S('verification', 'Verification')],
  decision:    [S('rationale', 'Rationale', 'long'), S('alternatives', 'Alternatives', 'long'), S('consequences', 'Consequences', 'long'), S('date', 'Date')],
  test:        [S('given', 'Given', 'long'), S('expected', 'Expected', 'long'), S('result', 'Result')],
  capability:  [S('outcome', 'Outcome', 'long'), S('measure', 'Measure')],
  feature:     [S('estimation', 'Estimate'), S('startDate', 'Start'), S('endDate', 'End')],
  story:       [S('acceptance', 'Acceptance', 'long'), S('estimation', 'Points'), S('startDate', 'Start'), S('endDate', 'End')],
  risk:        [S('impact', 'Impact'), S('likelihood', 'Likelihood'), S('mitigation', 'Mitigation', 'long')],
};

/** Every section an item of this type may carry, common fields first. */
export function sectionsFor(type: WorkItemType): SectionSpec[] {
  return [...COMMON, ...ITEM_SECTIONS[type]];
}

/** Type keywords as written in the DSL, including the short aliases. */
export const ITEM_KEYWORDS: Record<string, WorkItemType> = {
  requirement: 'requirement', req: 'requirement',
  decision: 'decision', adr: 'decision',
  test: 'test', tc: 'test',
  capability: 'capability', cap: 'capability',
  feature: 'feature', feat: 'feature',
  story: 'story', us: 'story',
  risk: 'risk',
};

export const LINK_KEYWORDS: Record<string, WorkItemLink> = {
  refines: 'refines', satisfies: 'satisfies', verifies: 'verifies',
  derives: 'derives', decides: 'decides', conflicts: 'conflicts',
  mitigates: 'mitigates', depends: 'depends', blocks: 'depends',
};

/**
 * Which (source → target) type pairs each link kind allows.
 *
 * This is the table that makes a work-item diagram checkable rather than
 * decorative: `verifies` from a requirement to a feature is a modelling error,
 * and saying so is the feature. `undefined` means the link is unconstrained
 * (`depends` and `conflicts` are ordering/consistency relations that can hold
 * between any two items).
 */
export const LINK_RULES: Partial<Record<WorkItemLink, { from: WorkItemType[]; to: WorkItemType[] }>> = {
  refines:   { from: ['requirement', 'capability', 'feature', 'story'], to: ['requirement', 'capability', 'feature'] },
  satisfies: { from: ['feature', 'story', 'decision'], to: ['requirement', 'capability'] },
  verifies:  { from: ['test'], to: ['requirement', 'feature', 'story', 'capability'] },
  derives:   { from: ['requirement', 'feature', 'story', 'capability'], to: ['requirement', 'capability', 'decision'] },
  decides:   { from: ['decision'], to: ['requirement', 'feature', 'story', 'capability', 'risk'] },
  mitigates: { from: ['requirement', 'decision', 'feature', 'story', 'test'], to: ['risk'] },
};

/** Bare-infinitive form of each link, for readable diagnostics ("a requirement
 *  cannot verify" rather than "cannot verifies"). */
export const LINK_VERB: Record<WorkItemLink, string> = {
  refines: 'refine', satisfies: 'satisfy', verifies: 'verify', derives: 'derive',
  decides: 'decide', conflicts: 'conflict with', mitigates: 'mitigate', depends: 'depend on',
};

/** Item types that must be verified by a test for coverage to be complete. */
export const VERIFIABLE: WorkItemType[] = ['requirement', 'capability'];

export function isItemType(s: string): boolean {
  return Object.prototype.hasOwnProperty.call(ITEM_KEYWORDS, s.toLowerCase());
}

export function isLinkKeyword(s: string): boolean {
  return Object.prototype.hasOwnProperty.call(LINK_KEYWORDS, s.toLowerCase());
}
