# Plan: Round-2 leftovers

Decided on 2026-10-26, after round 2 ([plan-legibility.md](plan-legibility.md)), the arch.md audit and the new examples.
Same rules apply:
- **Measured:** a new metric lands before its fix, and the gate stays on.
- **Same passes:** the metrics and the renderers use the same models.
- **Deterministic:** the output stays byte-identical across runs.

## Issues, alternatives, choice

| # | Issue | Alternatives considered | Chosen (why) | Owner |
|---|---|---|---|---|
| F1 | `seldia check` and the metrics corpus skip ```spice/circuit/netlist/kicad/pcb fences | (a) rewrite the examples as ```seldia; (b) a single core `fenceToSource(lang, body)` map, used by the preview, the CLI and the metrics | **b**. The preview already knows the mapping. One source of truth means a new spelling can never silently escape the gate. | Tester |
| F2 | Low-contrast text (mindmap) is invisible to the gate | (a) eyeball it; (b) a `lowContrastText` metric (WCAG ratio < 4.5 of text fill vs. the shape fill under it) | **b**, record-only first | Tester |
| E1 | `rank in` on two connected parts makes ELK throw | (a) catch and retry without hints; (b) orient the edges at hinted parts so the constraint is satisfiable; (c) hint through partitioning instead of layerConstraint | **b + a as a net**: satisfy what is satisfiable. If ELK still throws, re-run without hints and emit a warning diagnostic. Never fail a render because of a hint. | B |
| E2 | Fan-in/out: arrows share the final segment into a hub; 3-worker fan-out lays out as a staircase | (a) spread the endpoints along the node side (port fanning); (b) a nudge that also moves end segments; (c) merge into a bus junction (loses individual arrows); (d) ELK `nodePlacement.bk.fixedAlignment: BALANCED` for the staircase | **a + d**. Fanning: k endpoints on one side sit at (i+1)/(k+1) of the side, ordered by the approach coordinate (no new crossings), and the last orthogonal segment is re-bent. BALANCED placement centres symmetric fans. | B |
| E3 | CMOS inverter: messy MOSFET wiring; the `VDD` symbol collides with a label | (a) users add hints; (b) correct the MOSFET pin sides (NMOS D top, S bottom; PMOS S top, D bottom; G left); (c) power-symbol placement avoids labels and nodes (lengthen the stub, flip the label side) | **b + c**. The canonical inverter must render well without hints. | B |
| E4 | `edgeStyle: sketch` has no in-fence switch | (a) a front-matter key; (b) a fence directive `edges sketch|clean` → IR meta, with config as the default | **b**. It follows the IR contract (the renderer reads IR meta), and it is the same shape as the existing in-fence directives. | B |
| E5 | plantuml#12 import error | (a) skip it in the corpus; (b) fix the importer, or degrade gracefully (G3) | **b**: root-cause first; an unsupported construct degrades and never errors | B |
| T1 | Cylinder labels don't wrap or overflow; `[(...)]` gives a rectangle | (a) font shrink; (b) a wider node only; (c) node sizing uses the same `shapeTextBox` + `balancedWrap` as rendering; parser maps `[(...)]` → database | **c**. Size and draw text from one model (the round-2 lesson), plus Mermaid shape syntax parity. | A |
| T2 | Sankey flow labels overlap each other | (a) hide labels under a threshold; (b) stack them per column with a vertical dodge, hiding only if there is no room and moving the value to `<title>`; (c) put the values in node labels | **b**. Every value stays readable or discoverable, and it is deterministic. | A |
| T3 | Sequence self-message label sits on the lifeline | (a) put the label left of the lifeline; (b) put the label right of the loop and size the loop and lane gap to fit it | **b**. This is the UML convention, and it never crosses the lifeline. | A |
| T4 | Mindmap: low-contrast text; an edge runs under a label | (a) recolour the mindmap only; (b) a DS `readableTextOn(fill)` helper for all types, plus clipping mindmap edges to the shape boundary | **b**. It fixes the whole class of bug and is enforced by F2. | A |
| T5 | `component` with `group` drops nodes/groups (same family as block+group) | | Fix with the block+group bug, with a regression test | A |

Rejected across the board: per-example workarounds in docs. The examples must render well as written.

## Order
1. Tester: F1 and F2 (the metric is record-only).
2. Devs in parallel: A takes T1–T5, B takes E1–E5. File ownership follows plan-legibility.md.
3. Tester: rebuild, full tests, a baseline refresh, `seldia check` on docs/examples and docs/arch.md, and a determinism re-run.

## Round 2b: what the corpus still shows

The scratch metrics run after E1–E5 and T1–T5 still shows these problems, plus the items deferred in round 2a:

| # | Issue | Alternatives considered | Chosen (why) | Owner |
|---|---|---|---|---|
| S1 | Sankey: crossings=2, edgeOverlaps=2 (basic#25, mermaid#17); value chips overlap where flows converge | (a) exclude sankey from the crossing metrics, because bands are not edges; (b) d3-sankey link ordering: outgoing links sorted by target y, incoming by source y, plus a few deterministic relaxation passes of node y; (c) only enlarge the node gap | **b**. It is the established algorithm (Bostock and d3-sankey). Hiding the metric would only hide the problem. The chips then dodge on reserved chip rects. | A |
| S2 | plantuml#1 sequence: participant text overflows its box | (a) shrink the font; (b) size the participant from the balancedWrap text box, the same model as T1 | **b**, for consistency with T1 | A |
| S3 | mermaid#1 flowchart: groupViolations=1 | (a) a bigger group padding; (b) root-cause it (a node outside its cluster bbox, or sibling groups overlapping) and fix the layout input or the group bbox computation | **b**. Padding would hide a containment bug. | B |
| S4 | plantuml#11 flowchart: borderHugs=1 | (a) a nudge pass also pushes segments off node borders by `DS.portStub`; (b) a routing-only fix | **a**. It is in edge-layer postRoute, so it applies to every type. | B |
| S5 | Power symbols may collide with labels or nodes (deferred from E3) | (a) users add hints; (b) a candidate set (stub 12/24/36px, label left/right) chosen by the first that has no collision, which is deterministic | **b** | B |
| S6 | The VS Code preview duplicates the fence map, so it can drift | (a) leave it; (b) the preview compiles `fenceToSource` (changes the render path); (c) the preview dispatches on `fenceToSource(...).kind` and keeps its IR render path | **c**. One source of truth, with no render-path change. | B |
| S7 | PlantUML `@startjson` is counted as a failure | (a) implement a JSON tree type; (b) the harness reports importer-declined blocks as `unsupported`: not failed, listed separately | **b**. G3 graceful degradation is the contract, and a new type is scope creep. | Tester |
| S8 | The flowchart classDef contrast test doesn't assert the text colour | Assert the chosen fill/text ratio is ≥ 4.5 | (only option) | Tester |

Kept as is: readability#1 crossings=1 is intended (it shows the line jump).
