# Plan — Layout quality (ELK-first) + Circuit schematics + PCB view

Decided 2026-10-26 after a time-boxed research pass, a baseline visual audit (31 SelDiA + 20 Mermaid/PlantUML
fences) and an architect review. The baseline audit and research notes live in the session scratchpad. The decisions are below.

## Strategy: "ELK-first, measured"

- Every layout change is judged by numbers (F0 metrics) over the docs/examples corpus, not by eye alone.
- ELK becomes the graph layout engine **per diagram type, only where F0 shows a win**. Dagre remains as the fallback, via
  `layout dagre` or automatically on any ELK exception.
- elkjs runs **synchronously** by driving its FakeWorker dispatcher directly, bypassing `setTimeout`. This was proven by a spike
  (`register` cmd, then `layout` cmd, then the result arrives synchronously), so the Markdown preview (compileSync) gets ELK too.
  elkjs stays pinned to an exact version because this relies on its internals.
- New types: `circuit` (SPICE input, plus KiCad netlist input to cover SKiDL) is in scope. The `pcb` view is render-only and comes last.
  Autoplacement and autorouting of PCBs are out of scope (poor ROI). This deliberately overrides next_steps §5, because the user asked for it.

## ROI

| Feature | Cost | Value | Note |
|---|---|---|---|
| F0 metrics harness | S | enables everything | regression gate |
| F2 shape-aware clipping | S | fixes detached arrows on diamonds, ellipses and actors (all engines) | |
| F1 ELK-first pipeline | M | fixes cluster overlap, crossings, staircases, parallel-edge overlap, ragged ranks across about 12 types | core |
| F3 label nudge (lite) | S | labels off icons and borders | |
| F4 circuit schematics | M–L | new segment (EE docs-as-code); no good text-to-schematic tool exists in Markdown | cap about 40 parts |
| F5 PCB render-only | M | reads KiCad boards in docs | last |

## Features → tasks (priority order)

### F0 — Quality metrics harness (dev A, in progress)
- T0.1 `layout/metrics.ts`: crossings, edgeNodeHits, labelOverlaps, bends, groupViolations, endpointGap, area.
- T0.2 `scripts/layout-metrics.mjs` with `--engine dagre|elk`.
- T0.3 Vitest unit tests plus a corpus regression gate on **aggregate totals per type, with a tolerance** (not exact per-diagram values).
- T0.4 Fix the parser bug: `layout elk` swallows the following identifier (parser.ts ~1270). It corrupts the corpus.

### F2 — Shape-aware endpoint clipping (dev A, after F0)
- T2.1 Replace the rect-only `clipStart`/`clipEnd` (render/edge-routing.ts) with per-shape intersection: diamond, ellipse/circle,
  cylinder, hexagon, actor (bounding box of figure), rounded rect. Engine-independent.
- T2.2 Tests per shape. Target: endpointGap ≈ EDGE_GAP for every shape.

### F1 — ELK-first pipeline (dev B)
- T1.1 `layout/elk-sync.ts`: cached FakeWorker instance, register algorithms once, `layoutSync(graph)`. Used by both the sync and the async path.
  Test: sync output equals async output. Fall back to dagre on exception.
- T1.2 Build the compound graph: IRGroups become nested ELK children (tree built once; each edge declared in its lowest common ancestor);
  convert container-relative coordinates to absolute; read **all** `sections`; edge labels become ELK labels sized via text-measure.
- T1.3 Route ownership: set `edge.layoutRouted = true` when ELK routed the edge. The renderer and `routeBetween` (engine.ts ~869)
  then only clip endpoints (with F2's clip) and skip `fanAnchor`/`manhattanRoute`. `via` manual routes still win
  (`applyManualEdgeRoutes` stays last). The edit-mode positioned-IR channel must carry the flag and the label positions.
- T1.4 `layoutGroups` must keep ELK's compound bounds instead of recomputing them; leave group padding for the header band.
- T1.5 ELK options for graphs: layered, ORTHOGONAL, INCLUDE_CHILDREN, considerModelOrder NODES_AND_EDGES, LAYER_SWEEP,
  BRANDES_KOEPF + BALANCED, spacing.edgeEdge 12, edgeEdgeBetweenLayers 15, edgeLabels.placement CENTER,
  sideSelection SMART_DOWN, mergeEdges false, feedbackEdges true, thoroughness 10, group padding top 30.
- T1.6 Per-type default switch: config map `layoutEngineByType`. Flip a type to ELK only when F0 is no worse on every gated metric
  and better on crossings, edgeNodeHits or groupViolations. Custom-layout types (sequence, gantt, sankey, etc.) are untouched.
- T1.7 `layoutManual` uses the same engine as the auto layout (so dragging one node doesn't jump the diagram to a dagre layout).
- T1.8 Pin coordinate-asserting tests (demo.test.ts, engine.test.ts, edge-routing.test.ts) to `layout dagre`.

### F3 — Label nudge (lite) (dev A, after F2)
- T3.1 Network/BPMN labels currently skip the scorer; route them through it.
- T3.2 For ELK-placed labels: a post-pass that nudges off icons and node borders only.
- T3.3 (found by the tester) Node-own labels overlap their glyphs (network icons, the c4 Database cylinder top), and the BPMN gateway label sits on an outgoing edge.
  Add a `nodeLabelHits` metric (node label box ∩ edges / ∩ glyph art), then fix label anchoring for icon shapes.

### Per-type engine decision (2026-10-26)
ELK: block, component, network, state, class, workitem (fewer crossings/overlaps; bends are higher by design with orthogonal routing,
so they are not gated). Dagre: flowchart, er, deployment, and every TIE type. Revisit flowchart after ELK edges get clipToShape.

### F4 — Circuit schematics `circuit` (aliases `schematic`, `spice`) (dev B after F1, with dev A on symbols)
- T4.1 Test corpus of 8 SPICE netlists with expected parts and nets (Haiku tester).
- T4.2 SPICE subset parser → IR: R C L V I D Q M J X, `.subckt`/`.ends`, `.end`, `*` comments, `+` continuation, SI suffixes
  (f p n u m k meg g t), title line. Nodes = parts with typed pins; nets: 2-pin nets give a direct edge, nets with 3 or more pins
  give a 0×0 junction node. Node `0`/`gnd` and nets named VCC/VDD/VSS/VEE become per-pin power symbols, not wires.
  Hints in SPICE comments: `* @seldia rotate R1 90`, `* @seldia rank in R1 C1`, `* @seldia flip Q1`.
  Register the type in BOTH parser lists (alias map + pre-check) — see the workitem notes.
- T4.3 KiCad netlist (`(export (version …)`, as generated by SKiDL) → same IR. This covers SKiDL.
- T4.4 Symbol library (clean SVG, IEEE style, works under Rough): R, C, polarised C, L, V (DC/AC), I, D, LED, Zener,
  NPN, PNP, NMOS, PMOS, op-amp, GND, VCC/VDD rail, generic box for X/subckt. Each symbol defines pin offsets and sides.
- T4.5 Layout: ELK layered RIGHT, portConstraints FIXED_POS (pins from the symbol after rotation), NETWORK_SIMPLEX layering
  and placement, semiInteractive for rank hints, spacing.portPort 10, ORTHOGONAL. Junction dots where 3 or more segments meet.
  Labels: refdes plus value next to the symbol. Above 40 parts, emit a warning and degrade gracefully (still render).
- T4.6 docs: user_guide section, seldia-dsl skill example, DATA.md fixture rows, an examples/demo-circuits.md file.

### F5 — PCB view `pcb` (render-only, last)
- T5.1 Subset of the `.kicad_pcb` s-expr: Edge.Cuts outline, footprints (at/rotation, pads rect/circle/oval/roundrect,
  fp_line/fp_circle silk), segments (tracks), vias, layer colours; F/B side toggle via `side: back`.
- T5.2 Renderer (no Rough jitter; precise mm→px), a fixture board, and tests.

## Testing protocol (Haiku tester, after each feature)
Build, run the full vitest suite quietly, run `scripts/layout-metrics.mjs` for dagre and elk, render before/after PNGs of the
graph-type examples, view them, and report a delta table plus any visual regressions. Pass or fail only; no log dumps.
