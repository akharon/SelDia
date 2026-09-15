# Data Files & Fixtures

Guide to test data, golden values, fixtures, and reference data in SelDiA.

---

## Test Fixtures

| File | Purpose | Format | Usage |
|------|---------|--------|-------|
| `packages/core/tests/fixtures/*.sld` | SelDiA DSL sample files | SelDiA DSL | Parser unit tests |
| `packages/core/tests/fixtures/*.mmd` | Mermaid diagram samples | Mermaid | Input conversion tests |
| `packages/core/tests/fixtures/golden_ir.json` | Expected IR output | JSON | Comparison tests |
| `packages/mermaid-renderer/tests/golden_*.svg` | Expected rendered SVGs | SVG | Visual regression tests |

---

## Data Files

| File | Purpose | Format | When Used |
|------|---------|--------|-----------|
| `docs/examples/demo-basic.md` | Basic usage examples | Markdown + code | Documentation |
| `docs/examples/demo-mermaid.md` | Mermaid integration demo | Markdown + Mermaid | Tutorials |
| `docs/examples/demo-plantuml.md` | PlantUML conversion demo | Markdown + PlantUML | Tutorials |

---

## Golden Values

**IR Contract (Immutable Schema):**
```typescript
interface IRNode {
  type: 'diagram' | 'element' | 'edge' | 'style';
  id: string;
  attributes: Record<string, unknown>;
  children?: IRNode[];
}
```

**Rendering Fidelity:**
- **Mermaid**: Lossy (9-sample corpus)
  - Supported: flowchart, sequence, class, state
  - Unsupported: C4 (no native support; workaround used)
  - Loss rate: ~15% of complex style info
- **PlantUML**: Nearly lossless
  - Supported: all UML diagram types
  - Loss rate: ~2% (margins, advanced theming)

**Parser Conformance:**
- **Mermaid → IR**: All syntax must parse without error
- **SelDiA DSL → IR**: All clauses must produce valid IR
- **PlantUML → IR**: Must handle PlantUML subset (not full language)

---

## How to Use Test Fixtures

### Run Parser Tests
```bash
npm run test -- packages/core/tests/parser.test.ts

# Uses fixtures/*.sld and golden_ir.json
# Verifies: DSL input → IR output matches golden
```

### Add New Golden Value (Fidelity Testing)
```bash
# 1. Create diagram in Mermaid or PlantUML
# 2. Render with current renderer
npm run render --input=diagrams/test.mmd --output=test.svg

# 3. Manually verify output is correct
# 4. Copy to golden directory
cp test.svg packages/mermaid-renderer/tests/golden_test.svg

# 5. Add regression test
npm run test -- packages/mermaid-renderer/tests/regression.test.ts
```

### Test Renderer Fidelity
```bash
# Runs visual regression tests
npm run test:fidelity

# Compares current renders against golden SVGs
# Flags any changes > 5% visual difference (configurable)
```

---

## Example Diagrams

**Basic Flowchart:**
```seldia
diagram flowchart {
  start: circle "Start"
  process: rectangle "Process"
  decision: diamond "Decision?"
  end: circle "End"

  start -> process
  process -> decision
  decision -> end [label: "Yes"]
}
```

**Expected IR (Simplified):**
```json
{
  "type": "diagram",
  "id": "flowchart_1",
  "attributes": { "type": "flowchart" },
  "children": [
    { "type": "element", "id": "start", "attributes": { "shape": "circle", "label": "Start" } },
    { "type": "element", "id": "process", "attributes": { "shape": "rectangle", "label": "Process" } },
    { "type": "edge", "attributes": { "from": "start", "to": "process" } }
  ]
}
```

---

## Reference Data

**Supported Diagram Types:**
- Flowchart (all shapes)
- Sequence (actors, lifelines, messages)
- Class (inheritance, composition)
- State (states, transitions)
- C4 (context, container, component, code)
- BPMN (tasks, gateways, events)
- Entity-Relationship (entities, relationships)

**Color Palettes (Pre-defined):**
- Default (light colors)
- Dark (dark mode colors)
- Accessible (high contrast for WCAG AA)
- Custom (user-defined)

---

**Last updated:** 2026-09-15
