# Improvement plan

The single list of open work; it replaces the former roadmap. Items are proposals until someone picks them up, and an item that ships is deleted. Shipped work is in `git log` and the package READMEs. Design background is in [arch.md](arch.md), settings and gates in [reference.md](reference.md).

**Basis.** A review of the docs on 2026-11-13, two targeted code surveys (layout/routing, and rendering/architecture) and a few greps. Nothing here was measured by running new experiments. Items marked *verify first* rest on a reading of the code that nobody has confirmed with a test. The visual-editor items in [section 7](#7-visual-editor) come from the former roadmap and were checked against the code on the same date.

**Effort.** S = under a day, M = one to three days, L = a week or more.

**Invariants every change must keep.**

- An unimportable Mermaid/PlantUML block falls back to the default fence. It never becomes a SelDiA error box in a document whose author did not ask for SelDiA (G3).
- Every visual edit is a minimal `WorkspaceEdit` on the source text. The source is the single source of truth; the document is never regenerated from IR.
- A visual edit that cannot be mapped to a source line is skipped with a visible message, never guessed.
- Layout changes are measured: the `layout-metrics` gate stays on, and the metrics run the same passes as the renderer ([reference.md](reference.md)).

## 1. Summary

Three things stand out:

1. **The layout gate has almost no power.** The whole corpus (100 fences) has 5 crossings and every hard counter is 0, so the gate only catches catastrophes. Bends (491) are recorded but not gated, and alignment, stability and edge length are not measured at all. Every routing change below needs a better ruler first.
2. **Attach points are decided after layout, by patching.** Edges go centre to centre, are clipped, then four passes (apex snap, fan spread, port stubs, nudge) repair the result. The layout engine never knows where an edge enters a node, so it cannot minimise crossings or bends for the geometry that is finally drawn.
3. **The positioning says drift is the wedge, and no open item covered drift.** The visual editor used to be the stated priority even though [arch.md](arch.md) calls it "a feature, not the moat". Layout quality and look are seen on every render by every user; drift detection is the pitch. Both rank above editor conveniences. The editor items that protect correctness (verification, undo, edit matrix) stay, in [section 7](#7-visual-editor).

Top items by return, in suggested order:

| # | Item | Effort | Why it pays |
|---|------|--------|-------------|
| 1 | [M1](#m1-stress-corpus) + [M2](#m2-missing-metrics) Stress corpus, gate bends, add alignment/stability metrics | M | Enables every other layout item; cheap |
| 2 | [R1](#r1-ports-before-routing) Ports before routing | L | Removes the root cause of jogs, bad fan-out and diamond attach errors |
| 3 | [R3](#r3-straight-lines-and-alignment) Straight edges, near-miss snapping, working alignment hints | M | Most visible quality gain per line of code |
| 4 | [R4](#r4-stable-layout-across-edits) Stable layout across edits | M | Small source edit no longer reshuffles the diagram; needed for diff and animation |
| 5 | [L1](#l1-measure-and-ship-the-real-font) Measure and ship the real font | M | Default output currently depends on which fonts the viewer has installed |
| 6 | [L2](#l2-colours-as-css-variables) Colours as CSS variables, one SVG for light and dark | M | Fixes GitHub dark mode and opens user theming |
| 7 | [L4](#l4-visual-regression-and-contact-sheet) Visual regression and a contact sheet | S-M | No test can see look today |
| 8 | [A1](#a1-typed-node-data-instead-of-label-parsing) Typed node data instead of label parsing | L | Removes a known silent-drop bug class; unblocks structured editing |
| 9 | [A2](#a2-one-descriptor-per-diagram-type) One descriptor per diagram type | M | Adding a type goes from 8-10 edits to 1 |
| 10 | [F1](#f1-drift-check) Drift check | M | The positioning, made executable |
| 11 | [A3](#a3-keep-the-last-good-render) Keep last good render, then statement-level recovery | S, then M | Typing no longer blanks the diagram |
| 12 | [F2](#f2-png-output-and-copy-as-png) PNG output and copy as PNG | S | Already advertised in `--help`; needed for chat, slides, wikis |

## 2. Docs that disagree with the code

Done. The remaining debt is the user guide's section 5, tracked below.

## 3. Routing and alignment

### 3.1 How it works today

This is the pipeline as the code has it. It should replace the routing bullets in arch.md section 6.

| Stage | What happens | Code |
|-------|--------------|------|
| 1. Pick engine | The diagram's `layout` line, then config (`layoutEngineByType`, `defaultLayoutEngine`), then `elkWhenGrouped`. Custom-layout types skip stages 1-3 | `engine.ts` `requestedEngine`, `render/custom-layout.ts` `customLayoutFor` |
| 2. Place nodes | **dagre**; or **ELK layered** (Brandes-Koepf balanced, layer sweep, model order `NODES_AND_EDGES`, `INCLUDE_CHILDREN`, seed 1); or **auto**, which lays out up to about 6 dagre/ELK variants, scores them, and refines small ungrouped graphs with order sweeps and neighbour swaps; or **manual**, where nodes with `x`/`y` are pinned and the rest are auto-laid-out and offset below them | `layout/engines.ts`, `layout/refine.ts`, `engine.ts` `layoutManual` |
| 3. Route edges | **Two routers.** An edge ELK routed keeps ELK's orthogonal sections (`layoutRouted`) and is only clipped. Every other edge (all dagre layouts, all manual layouts, and any layout the refine pass touched, because refine resets `layoutRouted`) goes through the in-house grid A* router with all nodes as obstacles. A `via:` list pins interior points | `render/edge-routing.ts` `routeBetween`, `clipRouteToNodes` |
| 4. Attach | Ends are clipped to the shape outline (diamond, circle, hexagon, parallelogram, stadium; others as a box), then lengthened to a stub. There are no ELK ports and no side constraints; only circuits use ports | `render/shape-clip.ts`, `applyPortStubs` |
| 5. Post-route | In order: `snapApexes`, `fanPorts`, `simplifyRoutes`, `nudgeRoutes` (6 px steps), `unhugRoutes`, `avoidBands`, `simplifyRoutes`, `capBends`, then `findJumps`. Graph types only (`POST_ROUTE_TYPES`); circuits have their own net-aware variant | `render/edge-layer.ts` `postRoute` |
| 6. Labels | Candidate positions along the route (segment midpoints, 30% and 70%, near ends), each on the line and then offset; hard rejects for nodes, arrowheads, other edges and title bands; least-bad fallback with a dashed leader | `render/edge-label-placement.ts` |
| 7. Measure | `measureLayout` runs the same passes and counts defects | `layout/metrics.ts` |

Known properties: output is deterministic; there is no memory of the previous layout; there is no grid, no alignment hint, and no self-loop handling in core.

### 3.2 Measure first

#### M1. Stress corpus

*Why.* With 5 crossings in total, a change that doubles crossings on real diagrams can pass the gate. `docs/examples` is a gallery of small, tidy demos.

*How.*
- Add `packages/core/test/fixtures/layout-stress/`: 20-30 diagrams taken from real public repos (add the same samples to the fidelity corpora, which are hand-written today: 9 Mermaid, 7 PlantUML), plus a seeded generator for shapes the demos lack: DAGs of 20, 50 and 100 nodes, a hub with 12 neighbours, a grid, three levels of nested groups, back-edges, parallel edges, self-loops.
- Baseline it separately (`layout-stress-baseline.json`) so the demo gate stays strict and the stress gate can start loose.
- Gate `bends` per type at +10%. It is the only metric that still moves, and it is the one users notice.

#### M2. Missing metrics

Add to `measureLayout`, record for one release, then gate:

| Metric | Definition | Catches |
|--------|------------|---------|
| `jogs` | Segments shorter than 12 px between two bends | Micro-doglegs from near-miss alignment |
| `nearMissAlign` | Connected nodes in adjacent ranks whose centres differ by 1-12 px on the cross axis | Edges that should be straight and are not |
| `detour` | Routed length divided by Manhattan distance, mean and max | Edges taking the long way round |
| `flowViolations` | Edges pointing against the diagram direction that are not back-edges of a cycle | Avoidable upward arrows |
| `foreignGroupCrossings` | Edges passing through a group that holds neither endpoint | Routes cutting through unrelated boxes |
| `stability` | Remove the last-declared node, lay out both versions, mean displacement of shared nodes after best-fit translation, divided by the diagram diagonal | Reshuffling on small edits ([R4](#r4-stable-layout-across-edits)) |

`seldia check --explain` (S, optional) should print which pass produced each defect, by measuring after each post-route pass. This turns "the picture is wrong" into "nudge moved this segment onto that border".

### 3.3 Improvements

#### R1. Ports before routing

*Problem.* The engine lays out as if every edge ended at the node centre. Where the edge really attaches is decided later by clipping, and `snapApexes`, `fanPorts`, `applyPortStubs` and `nudgeRoutes` then repair the consequences. Crossing minimisation and node placement therefore optimise a geometry that is not the one drawn. Typical symptoms: a diamond whose yes/no branches leave from the same vertex, fans that cross right at the node, and a short jog next to a node where the clipped end no longer lines up.

*How.*
1. Add one pure function, `assignPorts(ir, direction)`, that gives every edge end a side and a slot. Default rule: incoming on the upstream side, outgoing on the downstream side, back-edges on a lateral side. Per-shape rules override it: a decision diamond takes input at the top vertex and spreads outputs over the other three; ER and class nodes prefer lateral sides; BPMN gateways follow the diamond rule.
2. ELK path: emit real ports. Set `elk.portConstraints=FIXED_SIDE` on nodes with a rule and leave the others free, set `elk.port.side` per port, and let ELK order and space them (`elk.portAlignment.default`, `elk.spacing.portPort`). `circuit/layout.ts` already builds ELK ports; lift that code.
3. dagre path: after placement, order the slots on each side by the position of the far end (so a fan never crosses itself), and hand the A* router fixed start and end points with a mandatory first and last direction.
4. Delete what becomes redundant: `fanPorts` and `snapApexes` as repair passes, and most of `applyPortStubs`.

*Done when.* On the stress corpus `jogs` and `bends` drop and `crossings` does not rise; `edge-layer.ts` is shorter, not longer.

#### R2. One routing behaviour, not two

*Problem.* A class diagram (ELK routes) and an ER diagram (A* routes) are drawn by different algorithms, so spacing between parallel edges, corner positions and the choice of which side to go around differ between types. Inside `auto`, a flowchart can flip between the two from one edit to the next, because refining a layout discards ELK's routes.

*How.* Decide by measurement, not by argument. Add a config switch `router: 'engine' | 'own'` and run the stress corpus three ways: ELK placement with ELK routes, ELK placement with own routes, dagre placement with own routes. Then:
- If the own router is within tolerance on ELK placements, make it the single owner of final geometry and treat ELK's sections as a hint. One behaviour, one set of bugs.
- If ELK's routes are clearly better, keep them, and stop the refine pass from throwing them away for edges it did not move.

Either way, improve the own router where it is structurally weak. It routes edges one at a time, so order matters and later edges cannot push earlier ones. The standard fix is to split it in two phases: route every edge for topology only (which side of each obstacle), then assign tracks to shared channels in one step, ordering parallel segments by where they come from and go to, and centring them in the free space. `nudgeRoutes` today separates overlaps in fixed 6 px steps from wherever the first edge landed, which is why bundles drift toward one side of a corridor.

#### R3. Straight lines and alignment

*Problem.* Nothing snaps, nothing aligns, and the hints in the user guide do not exist. A node offset by 4 px from its only neighbour costs two bends.

*How, cheapest first.*
1. **Engine options (S).** With `jogs` and `nearMissAlign` in place, try `elk.layered.nodePlacement.favorStraightEdges`, `bk.edgeStraightening=IMPROVE_STRAIGHTNESS` and `nodePlacement.strategy=NETWORK_SIMPLEX` as defaults per type. `auto` already tries some as variants; add the two new metrics to its score so it prefers the straighter one.
2. **Near-miss snapping (M).** New `layout/align.ts`, run after placement and before routing. For each edge between adjacent ranks whose ends are within `DS.alignSnap` (start at 12 px) on the cross axis, shift the lower-degree node so the edge is straight, unless that breaks `nodeSpacing` or moves a pinned node. Then round node centres to a 4 px grid so lines land on whole pixels. Re-route only edges touching a moved node.
3. **Hints that work (M).** Implement what the user guide promises, as body statements rather than attribute blocks:

   ```
   align row a b c        // same cross-axis coordinate
   align column d e
   rank first start       // also: rank last
   ```

   `rank first|last` maps to ELK `layering.layerConstraint`. For `align`, check whether the pinned elkjs has `layerChoiceConstraint`; if not, and for dagre in any case, enforce it in `align.ts` as a post-pass and report a diagnostic when the set cannot be aligned without overlap.
4. **Aspect-aware direction (S).** A long chain becomes a ribbon that is unreadable in a Markdown column or on a slide. When the diagram gives no `direction`, lay out both TB and LR for small graphs and keep the one whose aspect ratio is closer to the target (about 3:2 for Markdown, 16:9 for Marp). For long linear flows try ELK `wrapping.strategy`.

#### R4. Stable layout across edits

*Problem.* The thesis is diagrams that stay true as systems change, which means diagrams that are edited often. Today one added node can reshuffle everything: nothing carries over from the previous layout, and `auto` picks the best of several variants, so a small edit can flip the winner and move every node.

*How.*
1. Accept an optional previous result: `compileSync(source, { previous })`, where `previous` is the last positioned IR. The preview and the edit panel already hold it.
2. **Hysteresis in `auto`.** Store the winning variant in IR metadata. With `previous`, keep that variant unless another one scores better by a clear margin (start at 15%).
3. **Seeded ELK.** With `previous`, give surviving nodes their old coordinates and use ELK's interactive strategies for cycle breaking, layering and crossing minimisation. The auto engine already has a semi-interactive variant, so the plumbing exists.
4. **Manual mode.** Today the unpinned remainder is laid out separately and stacked below the pinned nodes. Use the same seeded layout with pinned nodes held fixed, so dragging one node leaves the others where they were.

*Done when.* The `stability` metric is recorded and falls sharply on the stress corpus; adding a leaf node in the preview moves only its neighbours. This also unlocks [L5](#l5-preview-polish) (animated transitions) and [F3](#f3-visual-diff-for-pull-requests) (visual diff).

#### R5. Correctness gaps, verify first (S each)

- **Parallel edges.** dagre is created with `multigraph: false` and keys edges by source and target, so two edges `a -> b` with different labels may collapse into one. Write the three-line fixture; if it fails, switch to a multigraph keyed by edge id.
- **Self-loops.** No handling was found in core. Give `a -> a` a fixed loop template on the lateral side and reserve space for it in node spacing.
- **dagre label size.** dagre is told a label is `length * 7` by 20 px. Use `text-measure.ts` like everything else.
- **Foreign groups.** The A* router treats nodes as obstacles. Make the interior of a group that contains neither endpoint a high-cost zone, so edges go around boxes they have no business in.

#### Not worth doing

- Replacing dagre or ELK, or writing a third engine.
- Unifying the custom-layout types (sequence, gantt, sankey, ...) with the graph pipeline. Their geometry is their grammar.
- ELK post-compaction of layered layouts (declined before as too costly for its gain; keep it declined).
- Curved or spline routing as a default. Orthogonal with rounded corners is the house style and the passes assume it.

## 4. Look and feel

Every change in this section that alters appearance goes through a designer agent with before/after PNGs, and the standing rule holds: no white casing and no chips under edges.

#### L1. Measure and ship the real font

*Problem.* The default theme draws in Caveat. Caveat is not a system font, the SVG does not embed it, and the width table in `text-measure.ts` is tuned for an Inter-like sans. So on most machines the default output falls back to Comic Sans or a generic cursive, with box sizes computed for a third font. On GitHub, where an SVG shown through `<img>` cannot load external fonts at all, it is always the fallback. The `nodeTextOverflow` metric cannot see this because it uses the same table.

*How.*
1. Generate one advance-width table per bundled family at build time from the font file (a small script with `fontkit` or `opentype.js`), and have `text-measure.ts` choose the table from the resolved `fontFamily`. Unknown families keep the conservative heuristic.
2. Add `embedFonts` (default on for the CLI and the GitHub Action, off in the preview, which can load the font through webview CSS): subset the font to the glyphs used and inline it as a base64 `@font-face` in the SVG `<style>`. Expect 10-20 KB per diagram.
3. Check overflow in a real renderer as part of [L4](#l4-visual-regression-and-contact-sheet).

#### L2. Colours as CSS variables

*Problem.* Stroke widths and font sizes are tokens with a lint. Colours are not: about 490 hex literals across 25 source files (some are legitimate theme data, many are in renderers). A committed SVG is light or dark, never both, so diagrams in a README look wrong for half the readers.

*How.*
1. Extend the token lint to colour: every `fill` and `stroke` in corpus output must resolve to a palette or `DS` value. Fix renderers until it is 0, as was done for `tokenViolations`.
2. Emit semantic classes (`seldia-surface`, `seldia-stroke`, `seldia-accent-1`, ...) and define them once in the SVG `<style>` through custom properties (`--seldia-bg`, `--seldia-node-fill`, ...). `var()` is not valid in presentation attributes, so this must go through classes or `style`.
3. Add `theme auto`: the same `<style>` carries a `@media (prefers-color-scheme: dark)` block that redefines the properties. This works inside an `<img>`, so one file is correct on GitHub in both modes.
4. Document the properties as the supported way to restyle a diagram from page CSS.

#### L3. One coherent default look

Questions for a design pass, not conclusions:

- **Mixed signals.** The default pairs hand-drawn nodes with crisp rounded orthogonal edges (`sketchy-light` with `edgeStyle: clean`). Decide whether that is intended, and make the theme own the edge style either way.
- **Imported diagrams.** Someone rendering their existing Mermaid expects something crisp. Consider `clean-*` as the default for `mermaid` and `plantuml` fences and sketchy for native ones.
- **Editor theme.** The preview maps VS Code dark/light to the sketchy themes only. Add a `seldia.theme` setting (`auto-sketchy`, `auto-clean`, or a theme id) and a high-contrast mapping.
- **Type scale.** Fix it at four sizes (title, node, edge label, annotation). The 8 remaining token violations are all `font-size=8`, which is below any readable size.
- **Hierarchy.** Nodes should dominate edges and edges should dominate groups: edge stroke a step lighter than node stroke, groups as a light tint with a small title, nested groups progressively lighter, at most six hues assigned by role.
- **Crisp lines.** Once [R3](#r3-straight-lines-and-alignment) puts coordinates on a grid, offset odd-width strokes by half a pixel so 1 px lines are not blurred.

#### L4. Visual regression and a contact sheet

*Problem.* There are no image tests. The metrics count geometry; nothing can see a wrong colour, a clipped glyph or an ugly corner. Design review depends on someone remembering to render PNGs.

*How.*
- `scripts/contact-sheet.mjs`: render the corpus (or a tagged subset) in each theme into one HTML page, with a `--compare <git-ref>` mode that puts before and after side by side. This becomes the standard input for the designer agent.
- A CI-only snapshot test over about 15 hero diagrams in two themes: rasterise with `@resvg/resvg-js` (no browser, deterministic once fonts are embedded per [L1](#l1-measure-and-ship-the-real-font)), compare with `pixelmatch` at a small tolerance, write a diff image on failure.

#### L5. Preview polish

- **Animated re-layout (S, after R4).** Match elements by `data-seldia-node-id` and animate the transform over about 180 ms when the SVG is swapped, respecting `prefers-reduced-motion`. Without stable layout this is noise; with it, an edit reads as an edit.
- **Accessible SVG (S).** Root `role="img"` with `<title>` from the diagram title and a generated `<desc>` ("flowchart, 7 nodes, 9 edges"); a `<title>` per node. Today only labelled edges have one.
- **Focus on click (S).** The hover highlight exists in CSS. Make it sticky on click so a neighbourhood can be studied in a dense diagram.
- No minimap. Fit-to-view and zoom already cover it at the diagram sizes this tool targets.

## 5. Architecture and design

#### A1. Typed node data instead of label parsing

*Problem.* Class, ER, gantt, gitgraph, mindmap, chart and sankey nodes carry their structure as newline-joined label text. At least four consumers re-parse it with their own regexes: the renderers, `render/custom-layout.ts` (lines 193, 610), `export/mermaid.ts` (lines 166, 251, 285, 303) and `export/sql-ddl.ts` (line 37). arch.md already warns that an IR-shape test cannot catch a dropped field. This keeps G1 in letter (everything reads the IR) and breaks it in spirit (the IR holds a string that must be parsed again).

*How.*
1. Define a discriminated union for `IRNode.data` per type (`ClassData { stereotype, attributes[], methods[] }`, `ErData { columns[] }`, `GanttTask { start, end, after }`, ...).
2. Fill it once, in the plugin transform and in the importers. Keep `label` as display text.
3. Add one adaptor, `dataFromLabel(node)`, used only where data is absent, so migration can go consumer by consumer. Order: exporters (smallest), custom layout, renderers.
4. Add a grep gate to the test suite that forbids `label.split(` and label regexes outside the adaptor.

*Pays for.* Structured visual edits (add a column, rename a method) become patches against fields; `diffDiagrams` can report "column added" instead of "label changed"; importers and exporters stop guessing.

#### A2. One descriptor per diagram type

*Problem.* A new type means edits in the enum, two parser lists, per-type branches in `engine.ts`, `layout/metrics.ts`, `POST_ROUTE_TYPES`, `customLayoutFor`, the exporters' guards, CodeLens, completion, the TextMate grammar and the skill docs. The compiler links none of them, and one silent failure is already known: a type missing from the parser's pre-check list loses its type keyword without an error.

*How.* One table in core, `DiagramTypeDescriptor`:

```ts
{ id, aliases, plugin, layout: 'graph' | CustomLayoutFn, defaultEngine,
  postRoute, sketchy, renderer, exporters: { mermaid?, plantuml? },
  editVocabulary, docs: { summary, example } }
```

Derive everything else from it: the parser's alias map and pre-check list (today two hardcoded lists, `TYPE_ALIASES` and `diagramTypes` in `packages/core/src/parser/parser.ts`; if another type is added before A2 starts, collapse the two into one first, S), `layoutEngineByType`, `POST_ROUTE_TYPES`, the `is...Exportable` guards, CodeLens gating, LSP completion and hover, `seldia list-types`, and at build time the grammar keywords and the type table in the skill and the user guide. A test asserts every `DiagramType` has a descriptor and that its `docs.example` compiles.

Splitting `render/custom-renderers.ts` (1962 lines) into one file per type falls out of this for free. Do not split large files as a project of its own.

#### A3. Keep the last good render

*Problem.* The parser stops at the first error and the diagram is replaced by an error. While typing, that is most of the time.

*How.* In two steps:
1. **Preview (S).** On a failed compile, keep the last good SVG, dimmed, with the diagnostic shown over it. About twenty lines in the preview plugin and the edit panel.
2. **Parser (M).** Statement-level recovery: on a `ParseError` inside a diagram body, record the diagnostic, skip to the next line at the same brace depth and continue. Render what parsed, with an "n errors" badge. The language server then reports all errors, not the first.

#### A4. Explicit layout stages

`engine.ts` (1304 lines) holds engine choice, manual layout and rendering, and control passes through flags such as `layoutRouted`. Model the pipeline of [section 3.1](#31-how-it-works-today) as a list of stage functions over one positioned-IR type: `place`, `ports`, `route`, `postRoute`, `labels`. The metrics then run the same passes by construction rather than by discipline, `check --explain` comes for free, and the experiments in R1 and R2 become a change to the list. Extract stages as R1-R4 touch them. Do not do it as a standalone refactor.

#### A5. Hygiene (S each)

- Build outputs are committed: `.vsix` files in the repo root and `packages/vscode-ext`, and compiled `.js`/`.d.ts` beside the sources in `packages/interaction/src`. Ignore them and publish the VSIX as a release asset.
- `@seldia/interaction` is types only. Fold it into core as a subpath export and drop the package.
- `lint` is `echo lint` in every package. Add a minimal ESLint config plus the grep gates from A1 and L2.
- The GitHub Action (`.github/actions/seldia-render`) has never run on a real runner. Do one manual run in a scratch repo before anyone relies on it; [F1](#f1-drift-check) and [F3](#f3-visual-diff-for-pull-requests) both build on it.
- Cache compiled fences in the Markdown preview by source, theme and config, so typing in one paragraph does not recompile every diagram in the document. *Verify first* that it does not already.

## 6. Features

#### F1. Drift check

*Why.* "SelDiA keeps it true" is the pitch, and today nothing in the product checks a diagram against the system it describes.

*How, smallest useful version first.*
1. **References.** Let a node or group carry `source: "packages/api/**"` (glob) or `source: "src/auth.ts#login"` (symbol).
2. **`seldia check --drift`.** Report a dead reference (the path or symbol no longer exists) as an error, and a stale candidate (referenced files changed in git after the diagram last changed) as a warning. This needs globbing and `git log`, not code analysis.
3. **Pull requests.** The existing Action comments: "this PR changes files shown in `docs/arch.md`, diagram 3".
4. **Real comparison where the truth is machine-readable.** Start with ER: import SQL DDL to IR (the reverse of `exportSqlDdl`), then `seldia drift schema.sld --against schema.sql` runs `diffDiagrams` and prints the missing table or column. Later sources: `docker-compose.yml` for deployment, workspace manifests for component, OpenAPI for sequence participants.

The `source:` attribute also powers navigation: click a node to open the code, and a CodeLens in the code that says which diagrams show it. That gives authors a reason to write the reference in the first place.

#### F2. PNG output and copy as PNG

`seldia compile --help` advertises PNG/PDF/HTML, but the command writes SVG only. Implement PNG with `@resvg/resvg-js`, loaded lazily so core stays dependency-light, and add a "Copy as PNG" button in the preview next to the SVG export. Chat tools, slides, wikis and issue trackers take PNG, not SVG. Needs embedded fonts ([L1](#l1-measure-and-ship-the-real-font)) to look right. Remove from `--help` whatever is still not implemented afterwards.

The same fault in a second command (S): `seldia md2pdf` is a stub that checks the file exists and prints instructions. Real PDF export exists only in the VS Code extension (Markdown to PDF and Marp export). Implement it in the CLI or remove the command.

#### F3. Visual diff for pull requests

`diffDiagrams` gives a structural diff. Render it: lay out the union of both versions once (so positions agree, see [R4](#r4-stable-layout-across-edits)), draw added elements green, removed ones red and dashed, changed ones amber. `seldia diff a.sld b.sld --svg`, and the Action posts it on the PR. Reviewers see what changed in the architecture without reading DSL.

#### F4. Quality tool for agents

Add a fourth LM tool, `seldia_checkDiagram`, returning the `seldia check` report. An agent that draws a diagram can then see "3 crossings, 1 label detached" and reorder declarations until it is clean. The check exists; this is wiring.

#### F5. Collapsible groups

The IR has `collapsible` and `collapsed` and the user guide documents them, but the parser never sets them. Implement: a collapsed group lays out as one node, edges to its members are re-targeted to it and de-duplicated, and the preview toggles it on click. This is the cheap route to levels of detail in a large architecture diagram. If it is not going to be built, delete the syntax from the user guide.

#### F6. Public playground

`<seldia-live>` exists. Deploy it as a static page with the source in the URL hash and a "paste your Mermaid" entry point. The engine position is only credible if people can try their own Mermaid in ten seconds without installing anything.

#### Not now: more diagram types

There are already 35 `DiagramType` values. Breadth is not the constraint; layout quality, editor quality and distribution are.

## 7. Visual editor

The editor writes back through pure patchers with a serialized edit queue and a snapshot undo (`EditSession`). The items below are the ones selected from the former roadmap, most important first.

#### E1. Real VS Code verification (M)

Undo, add-node, draw-edge and reconnect are covered by unit tests, but nobody has driven the built VSIX. Add one `@vscode/test-electron` suite: open a `.sld` and a Markdown fence in the custom editor, post drag/add/connect/undo messages, assert the document text. CI only, not in `npm test`.

#### E2. Undo that never loses a hand edit (M)

Undo stacks are dropped on any hand edit and lost when the panel closes. Routing Ctrl+Z to VS Code's native undo was deferred because the block-mode interleaving case needs a real session to check, so do this after E1. While there, move the intent-to-`TextEdit` mapping from `provider.ts` into `EditSession`, which today holds only source text and undo bookkeeping.

#### E3. Edit matrix and coverage gaps (M)

Replace the hand-counted "26 of 29 demo blocks editable" with a test: every demo block times every gesture (move, relabel, add, connect, reconnect, delete), apply the patch, recompile, assert the IR change. Known gaps it will show: state `[*]`, mindmap children and wireframe order-edges are not editable.

#### E4. Direct gestures and bend points (L, after R1 and R3)

- **Gestures.** Edge endpoints can be reconnected only through the context menu; there are no hover connection handles and no drag-from-handle. Adding a node inserts it immediately instead of showing a click-to-place ghost. Drag-node, label-edit and placing-node are still imperative DOM code in `webview/client/editor.ts`, outside `interaction-reducer.ts`.
- **Bend points.** The engine honors a per-edge `via` route and a `route:` attribute, but the editor has no bend-handle drag and no "reset route" or routing-style menu entry, so a route can be set only by editing the DSL by hand. Also re-test that ordinary edges stay obstacle-avoiding once a node is pinned.

*Done when.* Undo never loses a hand edit, arrows can be reconnected and bent and the bend survives reload, adding a node or edge never requires knowing the DSL, and the edit matrix runs in CI.

#### Later

Editing conveniences: multi-select or marquee, group drag, arrow-key nudge, duplicate, copy/paste, snap-to-grid and alignment guides (reuse the floorplan drag-guide code), change-shape menu, group/ungroup, resize. None is started; snap and guides wait for [R3](#r3-straight-lines-and-alignment).

## 8. Suggested order

1. **Truth (days).** the R5 fixtures; accessible SVG; keep the last good render.
2. **Rulers.** M1, M2, L4. After this step, every later claim of "better" has a number or a picture behind it.
3. **Geometry.** R3 steps 1 and 2, then R1, then the R2 experiment, then R4.
4. **Surface.** L1, L2, the L3 design pass, F2.
5. **Structure and wedge.** A2, then A1, then F1 and F3 on top of them.

The visual-editor work ([section 7](#7-visual-editor)) runs alongside: E1 to E3 at any time, E4 and snap-to-grid only after R1 and R3, because they would otherwise be built on attach points and coordinates that are about to change.
