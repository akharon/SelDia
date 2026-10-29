# Data Files & Fixtures

Guide to test data, golden values, fixtures, and reference data in SelDiA.

---

## Test Fixtures

| File | Purpose | Format | Usage |
|------|---------|--------|-------|
| `packages/core/tests/fixtures/*.sld` | SelDiA DSL sample files | SelDiA DSL | Parser unit tests |
| `packages/core/tests/fixtures/*.mmd` | Mermaid diagram samples | Mermaid | Input conversion tests |
| `packages/core/test/fixtures/circuits/*.cir` + `*.expected.json` | 8 SPICE netlists with expected parts, nets, power nets (top-level only; `.subckt` internals not expanded; `value` = model/subckt name for D/Q/M/X) | SPICE / JSON | Circuit (`circuit` type) SPICE parser tests (T4.2) |
| `packages/core/test/fixtures/circuits/09-skidl-rc.net` + `.expected.json` | KiCad netlist as SKiDL `generate_netlist()` writes it (pin functions B/C/E, `/mid` net name, single-pin net) | KiCad s-expr / JSON | KiCad importer test (T4.3); `test/circuit.test.ts` also covers the >40-part warning |
| `packages/core/test/fixtures/pcb/blinky.kicad_pcb` | Hand-written 30x20 mm board: 2 resistors (one rotated), LED, 2-pin header, 4 tracks (F.Cu/B.Cu), 1 via, Edge.Cuts outline | KiCad s-expr | `test/pcb.test.ts` parser and render tests (`pcb` type, render-only) |
| `packages/core/tests/fixtures/golden_ir.json` | Expected IR output | JSON | Comparison tests |
| `packages/mermaid-renderer/tests/golden_*.svg` | Expected rendered SVGs | SVG | Visual regression tests |
| `packages/core/test/fixtures/layout-baseline.json` | Layout-quality baseline per docs/examples fence, measured with the shipped defaults (`measureCorpus(..., 'defaults')`). Gated per diagram type on crossings, edgeOverlaps, borderHugs, nodeLabelHits, edgeNodeHits, labelOverlaps and groupViolations; `bends` is recorded but not gated | JSON | `layout-metrics.test.ts` gate: current <= baseline + max(1, ceil(10%)) per type. Regenerate from packages/core: `UPDATE_LAYOUT_BASELINE=1 npx vitest run test/layout-metrics.test.ts` |
| `docs/layout-metrics.json` | Live layout-metrics report: per-fence values and totals from the corpus | JSON | Written by `node scripts/layout-metrics.mjs [--engine dagre\|elk] [--quiet] [--out file]` (no `--engine` = shipped defaults). Not gated; regenerate, do not hand-edit |
| `packages/core/test/label-legibility.test.ts` | Label legibility over the docs/examples corpus: chips stay on their own edge, off arrowheads, nodes and group titles; token lint (`tokenViolations` = 0, every `stroke-width` and `font-size` is a DS token) | TypeScript | Run with the core suite |
| `packages/core/test/edge-layer.test.ts` | Unit tests for `render/edge-layer.ts`: `postRoute` (nudge, apex snap, title-band avoidance, jumps), `edgePathD`, `arrowheadSvg` | TypeScript | Run with the core suite |
| `packages/core/test/layout-metrics-labels.test.ts` | Hand-built IRs for the label metrics (`labelDetached`, `labelOnArrowhead`, `labelEdgeHits`, `groupTitleHits`, `parallelRunLength`) and `tokenViolations` | TypeScript | Run with the core suite |
| `packages/core/test/table.test.ts` | `table` type: pipe-row parsing, `^`/`<` merge resolution (chains, 2x2 blocks, escapes), invalid and non-rectangular merges degrading with diagnostics, engine compile and theming, lossy GFM export | TypeScript | Run with the core suite |
| `packages/vscode-ext/test/seldia-table-patch.test.ts` | Table editor write-back for `table` fences: merge/unmerge, span-aware insert/delete/move, marker escaping, GFM → fence conversion. Output is re-parsed with core's `parseTableBody` | TypeScript | Run with the vscode-ext suite |
| `packages/cli/test/check.test.ts` | `seldia check`: per-fence report, `--json`, `--max` exit code, bad extension | TypeScript | Run with the CLI suite |

**Readability metrics** (`measureLayout` in `layout/metrics.ts`, also in `docs/layout-metrics.json` and `seldia check`): `labelDetached` (chip more than 16px from its own edge), `labelOnArrowhead` (chip on the last 14px of an edge), `labelEdgeHits` (chip on another edge or a group title band), `groupTitleHits` (edge through a group title), `parallelRunLength` (px of overlapping collinear runs). `tokenViolations(svg)` counts `stroke-width` and `font-size` values that are not DS tokens.

---

## Data Files

| File | Purpose | Format | When Used |
|------|---------|--------|-----------|
| `docs/examples/demo-basic.md` | Basic usage examples | Markdown + code | Documentation |
| `docs/examples/demo-mermaid.md` | Mermaid integration demo | Markdown + Mermaid | Tutorials |
| `docs/examples/demo-plantuml.md` | PlantUML conversion demo | Markdown + PlantUML | Tutorials |
| `docs/examples/demo-circuits.md` | Circuit gallery: SPICE (`spice`/`circuit`/`netlist` fences), KiCad netlist, SKiDL, two `pcb` boards | Markdown + SPICE/KiCad | Tutorials |
| `docs/examples/demo-readability.md` | Readability gallery: line jumps, label chips, nested groups, shape-specific text, actors | Markdown + code | Tutorials, layout metrics corpus |

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
- **GFM (Markdown table) export of `table` diagrams** (`exportTableGfm`): Lossy
  - Supported: cell text, column alignment, header row
  - Lost: merged cells (GFM has no rowspan/colspan). The anchor keeps the text and the cells it covered are written empty, so re-importing gives an unmerged table.
  - `table` has no Mermaid/PlantUML mapping. `exportMermaid`/`exportPlantUml` return null and the CodeLens hides those lenses.

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
