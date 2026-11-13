# Architecture

SelDiA (Self-Diagramming Architecture) is a diagram **engine**: text in, SVG out, with an intermediate representation (IR) in the middle that everything else reads from. Usage is in [user_guide.md](user_guide.md), build/config/fixtures in [reference.md](reference.md), open work in [improve.md](improve.md).

## 1. Positioning

SelDiA is not a third diagram format competing with Mermaid and PlantUML. It is the engine that runs all of them: Mermaid and PlantUML are *inputs*, the SelDiA DSL is the native format for people who want its full power. The pitch is "keep your Mermaid, SelDiA keeps it true". The wedge is drift (diagrams going stale as systems change), not drawing.

Why this position:

- **Distribution beat capability.** Mermaid renders natively on GitHub and GitLab and every LLM writes it from memory; D2 has better layout and still loses because it needs a compile step. A new format that competes on feature count repeats D2's failure.
- **Generation is a commodity; maintenance is not.** Anyone can generate a diagram from a prompt. Reading one back as structure, validating it, mutating it and writing it back needs an IR, diagnostics and bidirectional sync, which Mermaid (a parser bolted to a renderer) and PlantUML (a Java tool with no Markdown-native path) do not have.
- **Consequence:** the engine position is only credible if import is good. The Mermaid and PlantUML importers are the positioning made executable, which is why each has a fidelity corpus gated in CI ([reference.md](reference.md)).
- **Edit mode is a feature, not the moat.** Visual editing inside VS Code's Markdown preview is a head start, and it is useful because the source stays the source of truth, but the strategy is the engine.

## 2. Golden rules

- **G1. The IR contract is law.** Every transformation reads the IR, never the raw AST. Parser to IR to layout to renderers and exporters.
- **G2. The plugin lifecycle is fixed.** Parse, analyze, transform (plugin), layout, render. No new stages, no reordering. Editor-only metadata (for example the edit vocabulary) is a data table, not a new plugin hook.
- **G3. Import falls back, never errors.** A Mermaid/PlantUML fence that cannot be imported falls back to the default fence. Unsupported constructs degrade to diagnostics.
- **G4. Fidelity is documented.** Mermaid export is lossy and the corpus tests say how; see [reference.md](reference.md).
- **Source is the single truth.** Visual edits are minimal text patches on the source, never a regeneration from IR; an edit that cannot be mapped to source is skipped with a message.

## 3. Packages

| Package | Role |
|---------|------|
| `@seldia/core` | Everything that does not need an editor: parser, analyzer, IR, plugins, layout, SVG renderer, importers, exporters, themes, diff, include/macro expansion, layout metrics. Dependencies: `dagre`, `elkjs`, `roughjs`. |
| `@seldia/cli` | The `seldia` command (commander). See user guide section on the CLI. |
| `@seldia/interaction` | Types only: the visual-edit and source-map vocabularies shared by the editor and core. The earlier runtime (selection, drag, zoom, undo, source maps) was deleted as dead code. |
| `@seldia/web` | Lit web components `<seldia-viewer>`, `<seldia-editor>`, `<seldia-live>` and a CodeMirror language definition. |
| `seldia-vscode` (`packages/vscode-ext`) | The VS Code extension: language server, Markdown preview plugin, visual edit panel, table editor, Marp preview, Markdown-to-PDF, export commands, LM tools. |

The agent surface is the extension's LM tools (`seldia_renderDiagram`, `seldia_validateDiagram`, `seldia_listDiagramTypes`) plus the `seldia-dsl` skill; there is no MCP package (it was removed).

## 4. Pipeline

`createEngine()` in `packages/core/src/engine.ts` returns an engine whose `compile`/`compileSync` run five steps; `validate` stops after step 2.

1. **parse** (`parser/parser.ts`): hand-written lexer and recursive-descent parser, DSL text to `DiagramAST`. Only the importers and `fence.ts` look at foreign syntax.
2. **analyze**: symbol resolution and semantic checks, each plugin contributing its own diagnostics.
3. **transform**: the plugin registered for the diagram type turns the AST into `DiagramIR` (`diagrams/*.ts`, one plugin per family).
4. **layout**: positions for nodes, groups and edge routes (section 6). Types with a custom grammar (sequence, gantt, sankey, mindmap, table, floorplan, circuit, pcb, ...) use their own layout in `render/custom-layout.ts` or their plugin.
5. **render**: SVG with Rough.js hand-drawn or clean styling (section 7).

`compileSync` is fully synchronous, including ELK (section 6), so the Markdown preview can use it. `compileIRSync` skips steps 1 to 3 and lays out an IR directly, which is how a positioned IR (carrying manual `x`/`y`) is rendered without reparsing.

### IR

`DiagramIR` (`ir/types.ts`) holds `nodes` (`IRNode`), `edges` (`IREdge`), `groups` (`IRGroup`), metadata and the `DiagramType`. `DiagramType` has 35 members:

flowchart, sequence, class, er, state, usecase, activity, component, deployment, c4-context, c4-container, c4-component, c4-code, bpmn, dmn, gantt, mindmap, network, chart-bar, chart-line, chart-pie, chart-radar, chart-scatter, gitgraph, form, sankey, block, timeline, wireframe, cloud, workitem, circuit, pcb, table, floorplan.

Some types carry structure in the node **label** (newline-joined lines) rather than in `node.data`: class, ER and the label-vocabulary types (gantt, gitgraph, mindmap, charts, sankey). Their renderers parse the label, so an IR-shape test alone cannot catch a dropped field; test through the renderer.

### Plugins

A `DiagramPlugin` (`plugin/types.ts`) declares an `id`, a `diagramType`, optional lifecycle hooks (`onRegister`, `onActivate`, `onDeactivate`) and, above all, `transform(ast, config) => DiagramIR`, plus optional layout defaults and semantic validation. `DefaultPluginManager` and `InlinePluginRegistry` keep them by id and by type. All plugins are built in and registered by the engine; there is no external discovery. Plugin families: flowchart, sequence, class, state, er, c4, bpmn, component, workitem, floorplan, circuit, pcb, table, and `misc` for the generic and standalone types.

Adding a type touches roughly ten places that the compiler does not link: the `DiagramType` enum; `TYPE_ALIASES` and the separate `diagramTypes` pre-check lists in `parser/parser.ts` (a type missing from the pre-check silently loses its keyword); the plugin registration; per-type branches in `engine.ts`; `layout/metrics.ts`; `POST_ROUTE_TYPES`; `customLayoutFor`; exporter guards; the VS Code CodeLens and completion lists; the TextMate grammar; and the skill docs. One descriptor per type is planned ([improvement plan](improve.md#a2-one-descriptor-per-diagram-type)). A new closed-vocabulary type should say so in its schema (see `workitem/schema.ts`).

## 5. Import, export and fences

- **Importers** (`import/mermaid.ts`, `import/plantuml.ts`): foreign text to IR. Mermaid: flowchart (with subgraphs and `style`/`classDef`/`linkStyle`), sequence, class, ER, state, gantt, pie, gitGraph, mindmap. PlantUML: 11 diagram families, no Java. Both return diagnostics instead of throwing.
- **`fenceToSource`** (`import/fence.ts`): the single map from a fence language (`seldia`, `mermaid`, `plantuml`, `spice`/`circuit`/`netlist`, `kicad`, `pcb`, ...) to a source kind. The preview, the CLI and the metrics corpus all go through it, so a new spelling cannot escape the gate. A `null` result wraps in the default fence (G3).
- **Exporters** (`export/`): `exportMermaid`, `exportPlantUml`, `exportBpmn` (BPMN 2.0 XML), `exportSqlDdl`, `exportTableGfm`. Each has an `is...Exportable` guard so UIs hide actions for unsupported types. `diffDiagrams` (`diff/`) gives a structural diff of two IRs; `expandIncludes` (`macro/`) resolves `include`.
- **Circuits and PCBs**: raw SPICE and KiCad-netlist text (`circuit/`) becomes IR with typed pins and power-net symbols; `.kicad_pcb` (`pcb/`) renders as a board and is render-only.
- **Tables**: the `table` type (`table/`) parses pipe rows with `^` and `<` merges and can feed a `chart` directive into a chart IR.

## 6. Layout

Per-type engine choice is configuration (`layoutEngineByType`, `elkWhenGrouped`, `auto*` limits; all in [reference.md](reference.md)), and a diagram's own `layout` line wins over it.

- **dagre**: the default for the types where the metrics showed no ELK win.
- **ELK** (`layout/elk-sync.ts`): elkjs driven synchronously through its FakeWorker, with the version pinned exactly because this depends on its internals. Used for class, state, component, network, block, workitem, circuits, and for any diagram with populated groups (`elkWhenGrouped`). Groups become real nested ELK clusters, and ELK's compound bounds are kept. Any ELK exception falls back to dagre.
- **auto** (flowchart): tries several dagre and ELK variants within node/edge budgets, then refines by median/barycenter sweeps and neighbour swaps, scored on gated defects, then `crossings * crossingBendWeight + bends`, rank skips and routed length (`layout/engines.ts`, `layout/refine.ts`). Large diagrams use a single ELK layout.
- **Manual positions**: nodes carrying `x`/`y` (written by drags) are laid out by `layoutManual`, which keeps the same engine so one dragged node does not reflow the diagram. A per-edge `via` list pins an interior route; a `route:` attribute selects the routing style.
- **Routing** (stage by stage, from `engine.ts` and `render/`):

| Stage | What happens | Code |
|-------|--------------|------|
| 1. Pick engine | The diagram's `layout` line, then config (`layoutEngineByType`, `defaultLayoutEngine`), then `elkWhenGrouped`. Custom-layout types skip stages 1-3 | `engine.ts` `requestedEngine`, `render/custom-layout.ts` `customLayoutFor` |
| 2. Place nodes | **dagre**; or **ELK layered** (Brandes-Koepf balanced, layer sweep, model order `NODES_AND_EDGES`, `INCLUDE_CHILDREN`, seed 1); or **auto**, which lays out up to about 6 dagre/ELK variants, scores them, and refines small ungrouped graphs with order sweeps and neighbour swaps; or **manual**, where nodes with `x`/`y` are pinned and the rest are auto-laid-out and offset below them | `layout/engines.ts`, `layout/refine.ts`, `engine.ts` `layoutManual` |
| 3. Route edges | **Two routers.** An edge ELK routed keeps ELK's orthogonal sections (`layoutRouted`) and is only clipped. Every other edge (all dagre layouts, all manual layouts, and any layout the refine pass touched, because refine resets `layoutRouted`) goes through the in-house grid A* router with all nodes as obstacles. A `via:` list pins interior points | `render/edge-routing.ts` `routeBetween`, `clipRouteToNodes` |
| 4. Attach | Ends are clipped to the shape outline (diamond, circle, hexagon, parallelogram, stadium; others as a box), then lengthened to a stub. There are no ELK ports and no side constraints; only circuits use ports | `render/shape-clip.ts`, `applyPortStubs` |
| 5. Post-route | In order: `snapApexes`, `fanPorts`, `simplifyRoutes`, `nudgeRoutes` (6 px steps), `unhugRoutes`, `avoidBands`, `simplifyRoutes`, `capBends`, then `findJumps`. Graph types only (`POST_ROUTE_TYPES`); circuits have their own net-aware variant | `render/edge-layer.ts` `postRoute` |
| 6. Labels | Candidate positions along the route (segment midpoints, 30% and 70%, near ends), each on the line and then offset; hard rejects for nodes, arrowheads, other edges and title bands; least-bad fallback with a dashed leader | `render/edge-label-placement.ts` |
| 7. Measure | `measureLayout` runs the same passes and counts defects | `layout/metrics.ts` |

- **Edge layer** (`render/edge-layer.ts`): a post-route pass that nudges collinear overlaps apart, pushes segments off node borders, snaps apexes, avoids title bands, and adds line jumps at crossings. Labels are placed by `render/edge-label-placement.ts`.
- **Determinism**: output is byte-identical across runs (seeds derive from type and edge id, ELK `randomSeed` is pinned). Declaration order is intentionally a way to steer layout.

### Measured, not eyeballed

`layout/metrics.ts` (`measureLayout`) counts crossings, edge/node hits, label overlaps, group violations, border hugs, label legibility and more, using the *same* passes the renderer runs. `scripts/layout-metrics.mjs` reports them over `docs/examples`, and a Vitest gate compares each diagram type to `layout-baseline.json` with a tolerance. `seldia check` exposes the same report. Any layout change must keep the gate green or refresh the baseline deliberately ([reference.md](reference.md)).

## 7. Rendering

- **Output** is SVG, always. `render()` in `engine.ts` draws groups, edges, nodes, arrowheads, then edge labels as plain text with a halo (that z-order is deliberate: nodes never cover labels).
- **Design tokens** (`render/design-system.ts`, `DS`): every stroke width, font size, radius and arrow size is a token, and a lint test (`tokenViolations`) enforces it over the corpus. Size and draw text from one model (`node-label-geometry.ts`, `layout/text-measure.ts`) so label boxes and drawn text cannot drift.
- **Styles**: `edgeStyle: clean` (rounded orthogonal edges, jumps, hover highlight through CSS) or `sketch` (Rough.js hand-drawn, `render/rough.ts`), switchable in a fence with an `edges sketch|clean` line. Themes (`themes.ts`): sketchy-light, sketchy-dark, clean-light, clean-dark, mono. Palettes (`BUILTIN_PALETTES`: default, dark, ...) swap colors. Text color is derived with a contrast helper (`readableTextOn`) and the legibility test asserts a 4.5 ratio.
- **Per-type renderers** (`render/custom-renderers.ts`, `floorplan-render.ts`, `workitem-render.ts`, `diagrams/*`): each type has its own visual grammar (lifelines for sequence, tables for ER, radial for mindmap, and so on), not a generic box-and-arrow fallback.

## 8. VS Code extension

- **Language server** (`language-server/`): diagnostics, completion, hover, definition, symbols for `.sld`/`.seldia`.
- **Markdown preview** (`markdown-preview/plugin.ts`): renders `seldia`, `mermaid`, `plantuml` and circuit/PCB fences inline, styles GFM tables, numbers diagrams in document order with captions and a TOC; CodeLens (`markdown/codelens.ts`) offers export, gated by the `is...Exportable` guards.
- **Edit panel** (`webview/provider.ts` plus the client bundle `webview/client/editor.ts`, built into `media/editor.js` under a nonce'd CSP). The provider owns write-back. Gestures post intents to the host; **pure patchers** (`edit/position-patch.ts`, `edit/table-patch.ts`, `edit/seldia-table-patch.ts`, `edit/floorplan-drag.ts`, `edit/blocks.ts`) turn them into minimal `TextEdit`s on the document, which makes them unit-testable without an extension host. `edit/serial-queue.ts` serializes edits; `edit/session.ts` (`EditSession`) keeps snapshot undo/redo and drops it when a foreign edit (typing in the text editor) arrives; `webview/client/interaction-reducer.ts` models the pointer modes (idle, selected, drawing-edge, reconnecting-edge). `getEditVocabulary(type)` in core (`plugin/edit-vocabulary.ts`) supplies the node and edge kinds the palette offers per diagram type.
- **Markdown-preview edits** need both `vscode://` deep links and the document URI from the Markdown-it environment; never `command:` URIs, never `activeTextEditor`.
- **Table editor** (`webview/table-provider.ts`): a grid editor for GFM tables and `table` fences with merge and chart-directive support.
- **Marp** (`marp/`): a slide-by-slide preview panel and PDF/PPTX/HTML export. Slide diagrams reuse the same fence renderers; diagram fitting is measured in layout space (`offsetTop`), not `getBoundingClientRect`, so the panel's scale transform is not applied twice.
- **Markdown to PDF** (`md2pdf/`): a Puppeteer pipeline (diagram injection, TOC, print CSS). Only the extension implements it.
- **Agent tools** (`lm-tools/`): the three `seldia_*` language-model tools; **skill** deployment commands copy the `seldia-dsl` skill (canonical copy in `resources/skills`).
- **Packaging**: `vsce package --no-dependencies` is required; `scripts/package-vsix.sh` handles it.

## 9. Web and CLI

`@seldia/web` exposes `<seldia-viewer>` (render a source string or `src`), `<seldia-editor>` (CodeMirror with the SelDiA language) and `<seldia-live>` (editor plus live preview). `@seldia/cli` is a thin layer over core: compile, render (a whole tree plus Markdown fences, used by the `seldia-render` GitHub Action), the `mermaid`/`plantuml`/`circuit` single-file renderers, export, diff, validate, check, init, serve, list-types, theme.

## 10. Decisions worth remembering

- **Custom DSL, with importers.** The DSL exists because per-type grammars (class, ER, BPMN, floorplans) need structure Mermaid cannot express; importers keep existing Mermaid/PlantUML usable.
- **Rough.js plus a clean mode.** Hand-drawn output signals "sketch, not spec" in design docs; clean mode with line jumps serves dense architecture diagrams.
- **SVG only.** Embeds everywhere, themable, selectable, diffable. PNG goes through external tools.
- **TypeScript monorepo, synchronous core.** Sync compile keeps the Markdown preview and CLI simple; async exists only where the layout call is async.
- **Security.** Labels and attribute values are escaped (`render/escape.ts`); the webview uses a nonce'd CSP; the PDF pipeline runs a headless browser only on content the user already has.
