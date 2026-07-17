// =============================================================================
// SelDiA — BPMN XML / SQL DDL Export Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine.js';
import { exportBpmn, isBpmnExportable } from '../src/export/bpmn.js';
import { exportSqlDdl, isSqlDdlExportable } from '../src/export/sql-ddl.js';
import { DiagramType } from '../src/ir/types.js';

function toIr(source: string) {
  const engine = createEngine();
  const r1 = engine.parse(source);
  expect(r1.ok).toBe(true);
  if (!r1.ok) throw new Error('parse failed');
  const r2 = engine.analyze(r1.value);
  expect(r2.ok).toBe(true);
  if (!r2.ok) throw new Error('analyze failed');
  const r3 = engine.transform(r2.value);
  expect(r3.ok).toBe(true);
  if (!r3.ok) throw new Error('transform failed');
  return r3.value;
}

// Shape syntax per resources/templates/bpmn.sld: (event) [task] {gateway}.
const BPMN_SOURCE = `diagram bpmn "Vacation Request" {
    start: (Request Submitted)
    approve: [Manager Approves]
    decide: {Approved?}
    done: (Approved)
    rejected: (Rejected)

    start --> approve
    approve --> decide
    decide -->|"yes"| done
    decide -->|"no"| rejected
}`;

const ER_SOURCE = `diagram er "Shop" {
    user: "User\\nid: UUID PK\\nname: string\\nemail: string"
    order: "Order\\nid: UUID PK\\nuserId: UUID FK\\ntotal: decimal"

    user -->|"1 : *"| order
}`;

describe('isBpmnExportable / isSqlDdlExportable', () => {
  it('BPMN exporter only covers BPMN', () => {
    expect(isBpmnExportable(DiagramType.BPMN)).toBe(true);
    expect(isBpmnExportable(DiagramType.ER)).toBe(false);
    expect(isBpmnExportable(DiagramType.FLOWCHART)).toBe(false);
  });

  it('SQL DDL exporter only covers ER', () => {
    expect(isSqlDdlExportable(DiagramType.ER)).toBe(true);
    expect(isSqlDdlExportable(DiagramType.BPMN)).toBe(false);
    expect(isSqlDdlExportable(DiagramType.FLOWCHART)).toBe(false);
  });
});

describe('exportBpmn', () => {
  it('returns null for non-BPMN diagrams', () => {
    const ir = toIr(`diagram flowchart "F" { a --> b }`);
    expect(exportBpmn(ir)).toBeNull();
  });

  it('emits well-formed BPMN 2.0 XML for a BPMN diagram', () => {
    const ir = toIr(BPMN_SOURCE);
    const xml = exportBpmn(ir);
    expect(xml).toBeTruthy();
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<bpmn:definitions');
    expect(xml).toContain('<bpmn:process');
    expect(xml).toContain('<bpmn:startEvent');
    expect(xml).toContain('<bpmn:endEvent');
    expect(xml).toContain('<bpmn:exclusiveGateway');
    expect(xml).toContain('<bpmn:sequenceFlow');
    expect(xml).toContain('<bpmndi:BPMNDiagram');
    expect(xml).toContain('<bpmndi:BPMNPlane');
  });

  it('emits one sequenceFlow per edge between flow nodes', () => {
    const ir = toIr(BPMN_SOURCE);
    const xml = exportBpmn(ir)!;
    const flowCount = (xml.match(/<bpmn:sequenceFlow/g) || []).length;
    expect(flowCount).toBe(ir.edges.length);
  });

  it('carries edge labels onto sequenceFlow name attributes', () => {
    const ir = toIr(BPMN_SOURCE);
    const xml = exportBpmn(ir)!;
    expect(xml).toContain('name="yes"');
    expect(xml).toContain('name="no"');
  });

  it('positions BPMNShape bounds from the laid-out IR', () => {
    const layoutResult = createEngine().layout(toIr(BPMN_SOURCE));
    expect(layoutResult.ok).toBe(true);
    if (!layoutResult.ok) throw new Error('layout failed');
    const xml = exportBpmn(layoutResult.value.diagram)!;
    expect(xml).toMatch(/<dc:Bounds x="\d+" y="\d+" width="\d+" height="\d+"/);
  });
});

describe('exportSqlDdl', () => {
  it('returns null for non-ER diagrams', () => {
    const ir = toIr(`diagram flowchart "F" { a --> b }`);
    expect(exportSqlDdl(ir)).toBeNull();
  });

  it('emits one CREATE TABLE per entity', () => {
    const ir = toIr(ER_SOURCE);
    const sql = exportSqlDdl(ir);
    expect(sql).toBeTruthy();
    expect(sql).toContain('CREATE TABLE User');
    expect(sql).toContain('CREATE TABLE Order');
  });

  it('marks PK columns and emits a PRIMARY KEY clause', () => {
    const ir = toIr(ER_SOURCE);
    const sql = exportSqlDdl(ir)!;
    // UUID, not INTEGER: ER_SOURCE declares `id: UUID PK`, and an explicit
    // declared type outranks the column-name type hint.
    expect(sql).toMatch(/id UUID NOT NULL/);
    expect(sql).toMatch(/PRIMARY KEY \(id\)/);
  });

  it('emits an ALTER TABLE ... REFERENCES for each relationship edge', () => {
    const ir = toIr(ER_SOURCE);
    const sql = exportSqlDdl(ir)!;
    expect(sql).toContain('ALTER TABLE Order ADD COLUMN');
    expect(sql).toContain('REFERENCES User(id)');
  });

  it('infers plausible types from attribute name hints', () => {
    const ir = toIr(ER_SOURCE);
    const sql = exportSqlDdl(ir)!;
    expect(sql).toMatch(/total DECIMAL\(10,2\)/);
  });
});
