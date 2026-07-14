// =============================================================================
// SelDiA — Integration Tests
// =============================================================================
// End-to-end tests that validate the full pipeline:
// DSL → Parse → Analyze → IR → Layout → Render → SVG
//
// Run with: node tests/integration.test.mjs
// Or: npm run test:integration

import { createEngine } from '../packages/core/dist/index.js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default engine (sketchy-light theme from DEFAULT_CONFIG)
const engine = createEngine();

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

// ---------------------------------------------------------------------------
// Test: Basic examples compile and render
// ---------------------------------------------------------------------------
console.log('\n📦 Basic compilation tests:');

// Flowchart
const flowchart = `diagram flowchart "Login Flow" {
    start: (Start)
    validate: [Validate Credentials]
    decision: {Valid?}
    success: [Dashboard]
    failure: [Error]
    start --> validate
    validate --> decision
    decision -->|"Yes"| success
    decision -->|"No"| failure
}`;
const r1 = await engine.compile(flowchart);
assert(r1.ok, 'Flowchart compiles without errors');
if (r1.ok) {
  assert(r1.value.svg.includes('<svg'), 'Flowchart produces SVG output');
  assert(r1.value.svg.length > 100, 'Flowchart SVG has substantial content');
  assert(r1.value.stats.nodeCount >= 5, 'Flowchart has 5+ nodes');
  assert(r1.value.stats.edgeCount >= 4, 'Flowchart has 4+ edges');
}

// Sequence
const sequence = `diagram sequence "API Call" {
    participant client: "Client"
    participant server: "Server"
    participant db: "Database"
    client -> server: "POST /data"
    server -> db: "INSERT"
    db --> server: "OK"
    server --> client: "201 Created"
}`;
const r2 = await engine.compile(sequence);
assert(r2.ok, 'Sequence compiles without errors');
if (r2.ok) {
  assert(r2.value.stats.nodeCount >= 3, 'Sequence has 3+ participants');
}

// Class diagram
const classDia = `diagram class "Domain Model" {
    user: [User]
    account: [Account]
    user --> account
}`;
const r3 = await engine.compile(classDia);
assert(r3.ok, 'Class compiles without errors');

// C4 Context
const c4 = `diagram c4-context "System Context" {
    person customer: "Customer"
    system banking: "Online Banking"
    system gateway: "Payment Gateway"
    customer -> banking: "Uses"
    banking -> gateway: "Processes"
}`;
const r4 = await engine.compile(c4);
assert(r4.ok, 'C4 Context compiles without errors');

// State diagram
const state = `diagram state "Order States" {
    [*] --> Created
    Created --> Paid: pay()
    Paid --> Shipped: ship()
    Shipped --> Delivered: deliver()
    Delivered --> [*]
}`;
const r5 = await engine.compile(state);
assert(r5.ok, 'State compiles without errors');

// BPMN
const bpmn = `diagram bpmn "Order Process" {
    startEvent start: "Start"
    task check: "Check Inventory"
    gateway decision: "In Stock?"
    task ship: "Ship Order"
    task reject: "Reject Order"
    endEvent end: "End"
    start --> check --> decision
    decision -->|"Yes"| ship
    decision -->|"No"| reject
    ship --> end
    reject --> end
}`;
const r6 = await engine.compile(bpmn);
assert(r6.ok, 'BPMN compiles without errors');

// ER diagram
const er = `diagram er "Data Model" {
    user: [User]
    account: [Account]
    user --> account
}`;
const r7 = await engine.compile(er);
assert(r7.ok, 'ER compiles without errors');

// Gantt
const gantt = `diagram gantt "Project Plan" {
    design: "Design Phase"
    ui: [UI Design]
    backend: [Backend Design]
    dev: "Development Phase"
    frontend: [Frontend]
    api: [Backend API]
    design --> ui
    design --> backend
    dev --> frontend
    dev --> api
}`;
const r8 = await engine.compile(gantt);
assert(r8.ok, 'Gantt compiles without errors');

// Mindmap
const mindmap = `diagram mindmap "Overview" {
    root: [Project]
    child1: [Requirements]
    child2: [Design]
    child3: [Dev]
    child4: [Testing]
}`;
const r9 = await engine.compile(mindmap);
assert(r9.ok, 'Mindmap compiles without errors');

// ---------------------------------------------------------------------------
// Test: Error handling
// ---------------------------------------------------------------------------
console.log('\n⚠️  Error handling tests:');

const badSyntax = 'diagram flowchart { broken syntax {{{ }';
const r10 = await engine.compile(badSyntax);
assert(!r10.ok, 'Invalid syntax produces error result');
if (!r10.ok) {
  assert(r10.errors.length > 0, 'Errors array is populated');
  assert(r10.errors[0].message.length > 0, 'Error messages have content');
}

// ---------------------------------------------------------------------------
// Test: Theme support
// ---------------------------------------------------------------------------
console.log('\n🎨 Theme tests:');

const themes = ['sketchy-light', 'sketchy-dark', 'blueprint', 'monochrome', 'clean'];
for (const themeId of themes) {
  const themedEngine = createEngine({
    config: {
      defaultTheme: themeId,
      render: { sketchy: themeId.startsWith('sketchy'), padding: 20, background: '#ffffff' },
    },
  });
  const r = await themedEngine.compile(flowchart);
  assert(r.ok, `Theme "${themeId}" works without errors`);
  assert(r.value.svg.includes('<svg'), `Theme "${themeId}" produces SVG`);
}

// ---------------------------------------------------------------------------
// Test: CLI example files
// ---------------------------------------------------------------------------
console.log('\n📁 Example file tests:');

const examplesDir = resolve(__dirname, '..', 'examples');
const exampleFiles = [
  'flowchart-login.sld',
  'sequence-oauth.sld',
  'c4-internet-banking.sld',
  'showcase.sld',
];

for (const file of exampleFiles) {
  const fpath = resolve(examplesDir, file);
  if (existsSync(fpath)) {
    const source = readFileSync(fpath, 'utf-8');
    const r = await engine.compile(source);
    assert(r.ok, `Example "${file}" compiles without errors`);
    if (r.ok) {
      assert(r.value.svg.includes('<svg'), `Example "${file}" produces SVG`);
    }
  } else {
    console.log(`  ⏭️  Example "${file}" not found (skipped)`);
  }
}

// ---------------------------------------------------------------------------
// Test: Synchronous compile + styling + position override (Markdown preview path)
// ---------------------------------------------------------------------------
console.log('\n🧩 Engine capability tests:');

const syncResult = engine.compileSync(flowchart);
assert(syncResult.ok, 'compileSync() renders without awaiting');
assert(typeof syncResult.then === 'undefined', 'compileSync() returns a value, not a Promise');

const idSvg = engine.compileSync('diagram flowchart "T" { alpha: (Start)\n beta: [Do]\n alpha --> beta }');
assert(idSvg.ok && idSvg.value.svg.includes('data-seldia-node-id="alpha"'), 'SVG carries data-seldia-node-id for interaction');

const styled = engine.compileSync('diagram flowchart "T" { a: (Start) { fill: "#fff", roughness: 2 } }');
assert(styled.ok, 'Inline node style block compiles');

const moved = engine.parse('diagram flowchart "T" { a: (Start) { x: 500, y: 333 }\n b: [Do]\n a --> b }');
if (moved.ok) {
  const laid = engine.layout(engine.transform(engine.analyze(moved.value).value).value).value;
  const a = laid.diagram.nodes.find((n) => n.id === 'a');
  assert(a.position.x === 500 && a.position.y === 333, 'Flat x/y layout override positions the node');
} else {
  assert(false, 'Position-override DSL parses');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(50));
console.log(`📊 Integration Test Results:`);
console.log(`   ✅ Passed: ${passed}`);
console.log(`   ❌ Failed: ${failed}`);
console.log(`   📈 Total:  ${passed + failed}`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
