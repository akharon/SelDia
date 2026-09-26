# SelDiA — Next Steps

**Date:** 2026-09-26
**Purpose:** The single actionable roadmap. Strategic reasoning lives in [market.md](market.md); design intent in [arch.md](arch.md) (§5.8.3–5.8.6 and §9.4 describe the visual editor this plan finishes).

---

## 1. The strategic bet

> **SelDiA is not a third diagram format. It is the diagram *engine* that runs everyone's — Mermaid and PlantUML included.**

"Keep your Mermaid. SelDiA keeps it true." Mermaid is a format, PlantUML is a tool, SelDiA is the engine: parse, validate, query, render, round-trip. The wedge is drift, not drawing.

The engine side of that bet is built. **The editor is not.** An engine that claims to keep diagrams true but whose visual editor can't move an arrow or undo reliably undercuts the whole pitch the first time someone clicks "Edit Visually". The editor is the next priority — §3.

---

## 2. Already shipped (one line each — details are in git history and memory)

| Area | State |
| --- | --- |
| Mermaid import/export | 9 types → IR, subgraphs, styling directives, export return leg, 9-sample fidelity corpus, CLI + VS Code export |
| PlantUML import/export | 11 families, scored routing, 7-sample corpus, no Java |
| Distribution | `seldia render`, `seldia-render` GitHub Action, `<seldia-viewer>` docs + DOM tests |
| Agents | `@seldia/mcp` server incl. full IR→`.sld` serializer (`write_diagram`) |
| Work-item / traceability diagrams | closed vocabularies, warnings-only validation |
| Tier 2 | themes/palettes, macro/include, BPMN XML + SQL DDL export, `seldia diff`, Edit Visually for Markdown fences |
| Marp | slide preview panel, PDF/HTML/PPTX export ([roadmap.md](roadmap.md) plan is implemented) |
| Floorplan | dimensioning, `measure`, drag guides |

**Invariants that must survive every future change:**
- An unimportable Mermaid/PlantUML block **falls back to the default fence** — never a SelDiA error box in a document whose author never asked for SelDiA.
- Every visual edit is a **minimal `WorkspaceEdit` on the source text**; the source is the single source of truth. Never regenerate the whole document from IR.
- Visual edits that can't be mapped to a source line are **skipped with a visible message**, never guessed.

---

## 3. Priority 1 — Make the visual editor match the engine

### 3.1 Current state (audited 2026-09-26)

The editor is one 1,855-line file, [`webview/provider.ts`](../packages/vscode-ext/src/webview/provider.ts), with the entire webview client (~800 lines of JS) inlined in a template string. Write-back goes through pure patchers in [`edit/position-patch.ts`](../packages/vscode-ext/src/edit/position-patch.ts), which are reasonably tested (`edit-patchers.test.ts`, `position-patch.test.ts`, `block-edit.test.ts`). **Everything above the patchers has zero tests**: the gesture code, the interaction state, the undo model, and the host message handlers.

What works: drag a node (writes `x`/`y`), edit node/edge labels, delete node/edge, Edit Style (fill/stroke/text color via QuickPick), floorplan drag/rotate.

What doesn't, and why:

| Symptom | Root cause |
| --- | --- |
| **Can't move connections/arrows** | Edges support only select, relabel, delete. There is no reconnect gesture, no bend-point gesture, and no DSL syntax for a user-pinned route. Edge waypoints are always computed (dagre/elk/manhattan in `engine.ts`); in manual-position mode they degrade to straight centre-to-centre lines (`computeWaypoints`, `engine.ts:381`). |
| **Undo is unreliable** | (1) The panel keeps its own snapshot stack (`_undoStack`, `provider.ts:109`) that is **never invalidated by hand edits** — undo after typing in the text editor replaces the whole source with a stale snapshot and silently discards the typing. (2) Two competing stacks: Ctrl+Z in the panel uses snapshots, Ctrl+Z in the text editor uses VS Code's native stack, and each records the other's changes as ordinary edits, so they drift apart. (3) Handlers are `async` and **not serialized** — two quick drags interleave `groundTruth()`/`applyEdit`, pushing a snapshot that was already stale. (4) `restoreSource()` skips `syncDirty()`/autosave. (5) The stack is lost when the panel closes. |
| **Add node is not explicit** | `handleNodeAdded` appends `nodeN: [New Node N]` before the closing brace — no shape choice, no position (auto-layout puts it anywhere, often off-screen), no label prompt, and the flowchart statement is emitted for *every* diagram type (wrong for sequence, class, ER, state…). |
| **Draw edge is not explicit** | Toggle button + click source + click target. No rubber-band preview line (arch.md §9.4.5 specifies one), no hover ports/handles, no hint of what mode you're in beyond a highlighted button, no edge-kind choice (class relations, ER cardinality, sequence message types all come out as `-->`). |
| **Architecture drift** | arch.md §9.4.2 describes gesture → edit intent → IR mutation → source-map patch. The real code bypasses `@seldia/interaction` entirely at runtime (only type imports remain). `webview/edit-handler.ts`, `webview/undo-manager.ts`, `webview/renderer.ts`, `utils/sync-controller.ts` are orphaned; `interaction`'s `drag-drop`, `selection`, `zoom-pan`, `diff-patcher` are reimplemented inline in the template string. |
| **Coverage gaps** | State `[*]`/implicit nodes, mindmap children, wireframe order-edges are uneditable (26/29 demo blocks editable, measured by hand once, never re-measured). |

### 3.2 Plan — in order

Each step ends with tests green and a check in real VS Code (build the VSIX, drive the panel, and look at the result, not only the test output).

**Step 0 — Make the editor testable (prerequisite, no behaviour change).** — *Partially done (2026-09-26): 0.1, 0.4 shipped; 0.2 partially shipped; the "positioned IR + intent→TextEdit" half of 0.3 still open.*
1. ~~Move the inline webview script out of `provider.ts` into `src/webview/client/*.ts`, bundled by esbuild into `media/editor.js` and loaded with the existing CSP nonce.~~ **Done** — `src/webview/client/editor.ts`, bundled by a third esbuild config in `scripts/build.mjs` into `media/editor.js`; `getHtmlContent` now emits a nonce'd `<script>` pair (`window.__seldiaInit = {...}` + the bundle) and the CSP is `script-src 'nonce-...'`, not `'unsafe-inline'`.
2. **Partially done.** `src/webview/client/interaction-reducer.ts` extracts the pure mode-transition slice (`idle | selected | drawing-edge`, click/escape/toggle-edge-draw → state + effects) with 8 unit tests (`test/interaction-reducer.test.ts`); `editor.ts` now dispatches into it for click, Escape, and Add-Edge (toolbar + context menu) instead of mutating mode/selection inline. **Not done**: drag-node, bend/reconnect, label-edit, and placing-node are not modeled in the reducer — they stay as imperative DOM code in `editor.ts`, since folding drag/geometry math (floorplan guides, zoom-relative drag deltas) into the reducer's effect list is a larger, behavior-risking rewrite that couldn't be verified without a real VS Code session (same class of risk flagged for step 1.3). Revisit when real-VS-Code verification is available.
3. **Half done.** `EditSession` (`src/edit/session.ts`) is pure and unit-tested, but only covers source text + undo/redo bookkeeping — it does not yet hold positioned IR or map intents → `TextEdit[]` (that logic is still inline in `provider.ts`, calling the patchers in `edit/position-patch.ts` directly). `provider.ts` is otherwise VS Code glue.
4. ~~Delete the orphaned modules...~~ **Done** — `edit-handler.ts`, `undo-manager.ts`, `webview/renderer.ts`, `utils/sync-controller.ts` deleted (zero real importers, confirmed by grep); `@seldia/interaction`'s dead runtime (`manager`, `zoom-pan`, `selection`, `drag-drop`, `diff-patcher`, `collapse-expand`, `tooltips`, `aria`, `code-generator`, `source-map-builder`) deleted along with their tests, package trimmed to its two type-only files (`visual-edit-types.ts`, `source-map-types.ts`). arch.md §5.4 rewritten to describe the types-only package; §9 left as forward-looking design intent (unchanged).

**Step 1 — Fix undo/redo.** — *Done (2026-09-26), except 1.3's native-undo option (explicitly deferred, see below).*
1. ~~**Serialize all edits**...~~ **Done** — `SerialQueue` (`src/edit/serial-queue.ts`); every edit-producing `handleMessage` case and `promptStyleEdit`'s write run through `_editQueue.run(...)`.
2. ~~**Invalidate on foreign edits**...~~ **Done**, via the simpler of the two options — `onDidChangeTextDocument` calls `EditSession.onForeignEdit()` (drops both stacks and adopts the new source) rather than the rebase-by-range alternative; acceptable because it only costs the undo history, never correctness, and is much simpler to reason about.
3. **Deferred by explicit decision, not verified.** Routing to native `vscode.commands.executeCommand('undo'|'redo')` needs verification in real VS Code (interleaving with block-mode edits elsewhere in a `.md`) that isn't possible from this environment. Asked the user; decision was to keep the `EditSession` snapshot stack rather than switch un-verified. Revisit if the native route is wanted later — it needs a real VS Code session to check the block-mode interleaving case first.
4. ~~Undo restores selection and doesn't reset zoom/pan; `syncDirty()` + autosave after undo/redo.~~ **Done** — `restoreSource()` now calls `syncDirty()` and `autoSaveIfEnabled()`.
5. ~~Tests: `EditSession` unit tests...~~ **Done** for the sequences listed except "undo in block mode with edits elsewhere in the `.md`" (needs a real document/editor, not unit-testable in isolation) — see `test/edit-session.test.ts` (7 tests) and `test/serial-queue.test.ts` (2 tests).

Not addressed by Step 1: "the stack is lost when the panel closes" (`EditSession` is an in-memory field on the provider, same as the old stacks) — next_steps.md lists it as a symptom but doesn't prescribe a fix; flagging for a future pass rather than scoping it in silently.

**Verification still needed for both steps above:** this pass has green unit tests and a clean `npm run build`/typecheck across the whole monorepo, but per this section's own rule ("each step ends with... a check in real VS Code"), nobody has built the VSIX and driven the panel by hand yet.

**Step 2 — Explicit add-node.** — *Done (2026-09-26), except 2.2's click-to-place ghost/ghost-cursor placement (see below).*
1. ~~Add a `DiagramPlugin.editVocabulary()`...~~ **Done, as a data table, not a plugin hook** — `getEditVocabulary(type)` in `packages/core/src/plugin/edit-vocabulary.ts`, keyed by `DiagramType`, covering flowchart, BPMN, sequence, class, ER, state, C4 context, C4 container, with a generic flowchart-shape fallback for every other type. Deliberately kept out of `DiagramPlugin` to respect G2 ("plugin lifecycle is fixed") — this is editor-only metadata, not a new pipeline stage.
2. **Partially done.** Toolbar now has a palette popover per button (`#nodePalette`/`#edgePalette` in `provider.ts`, populated from the vocabulary in `editor.ts`'s `renderPalettes()`) so the user picks a kind explicitly instead of always getting a flowchart rectangle. **Not done**: click-to-place with a ghost under the cursor — picking a palette entry currently inserts the node immediately (centroid + jitter position) rather than entering a `placing-node` mode that waits for a canvas click. The label editor does open immediately on the new node (`focusNodeId` round-trip through `updateContent`), matching the rest of 2.2's intent.
3. ~~Emit the statement next to the last node declaration...~~ **Done** — `computeAppendStatementEdit` now inserts right after the last non-blank body line (not blindly before `}`) and derives the indent from that line (falls back to 4 spaces for an empty body); callers in `provider.ts` no longer hardcode indentation.
4. ~~For types whose layout ignores `x`/`y`... say so in the status bar.~~ **Done** — `handleNodeAdded` shows a `vscode.window.setStatusBarMessage` note when the chosen vocabulary entry is `positionable: false`.
5. ~~Tests: per-type template → patch → recompile → node exists...~~ **Done** — `packages/core/test/edit-vocabulary.test.ts` round-trips every template through the real parser/engine (26 tests); `packages/vscode-ext/test/edit-patchers.test.ts` unit-tests `buildNodeStatement`/`buildEdgeStatement` and the new indent-aware `computeAppendStatementEdit` behavior.

Found along the way: the shipped `c4-container.sld` template's `containerDb` keyword doesn't parse — `packages/core/src/parser/parser.ts`'s `isShapeKeyword()` only strips a `_Ext`/`_ext` suffix, not arbitrary camelCase compounds. Not fixed (out of scope here); the edit vocabulary's own "Database" kind uses the working `container id: "…" "Database" "…"` form instead. Tracked in §4 below.

**Step 3 — Explicit draw-edge.** — *Done (2026-09-26), except the hover-handle/drag-from-handle gesture in 3.1 (see below).*
1. **Partially done.** No hover connection handles (N/E/S/W) and no drag-to-connect — the click-source/click-target flow from before this step is unchanged. What's new: once a source is picked, a live dashed rubber-band line (`.edge-draw-line`, wired to a real `<line>` element for the first time — the CSS rule existed but was dead) follows the cursor from the source node's centre (`nodeCenterSvg` via `getBBox`/`getCTM`), and the node under the cursor highlights via `.seldia-edge-target`. Dropping (clicking) on empty canvas while a source is picked now offers "create connected node here" instead of being a no-op — new reducer effect `postCreateConnectedNode`, reusing Step 2's `nodeAdded`/`connectFromId` path. **Not done**: a true drag-from-handle gesture (mousedown on a handle → drag → mouseup on target) — same class of DOM/geometry rewrite risk flagged for step 0.2's drag-node extraction, deferred pending real-VS-Code verification.
2. ~~Keep the toolbar/context-menu flow, but add a visible mode banner... and a crosshair cursor.~~ **Done** — mode banner already existed (Step 1); crosshair now toggles via `#container.seldia-drawing-edge` in the same `setAddEdgeButtonActive` effect handler that shows/hides the banner.
3. ~~Edge-kind picker from the same edit vocabulary...~~ **Done, from the prior session** — `#edgePalette` popover (see Step 2's `renderPalettes()`), unchanged in this pass.
4. ~~Open the edge label editor after creation...~~ **Done** — `handleEdgeAdded` records the new edge's source/target, resolves it to the recompiled IR's actual edge id (`_pendingFocusEdgeEndpoints`, looked up post-recompile since the id format varies per diagram type — `edge-<src>-<tgt>` for flowchart, `class-edge-`, `ste-`, `bpme-`, `ere-`, `seq-edge-<index>` for others — so it can't be guessed ahead of time) and sends it to the client as `focusEdgeId`, mirroring `focusNodeId`.
5. **Partially done.** Reducer transition for the new `CLICK_EMPTY` + source-picked case is unit-tested (`interaction-reducer.test.ts`, 9 tests total). **Not done**: "patch per edge kind round-trips through the parser" — no new test added this pass; the existing `edit-vocabulary.test.ts` (26 tests, from Step 2) already covers per-kind edge templates round-tripping through the real parser, which covers this requirement in substance even though it predates Step 3.

**Step 4 — Move connections.** — *Partially done (2026-09-26): 4.1 shipped end-to-end; 4.2/4.3's engine/IR/parser plumbing shipped, but the bend-point drag UI and per-edge routing-style context menu are not built; 4.4 not re-verified; 4.5 partially covered.*
1. ~~**Reconnect**: selecting an edge shows endpoint handles...~~ **Done, via context menu instead of drag handles** — `Reconnect Source`/`Reconnect Target` context-menu items on an edge enter a new `reconnecting-edge` reducer mode (mirrors `drawing-edge`'s banner/Escape-cancel pattern, `interaction-reducer.ts`); clicking a node completes it. New pure patcher `computeEdgeReconnectEdit(source, srcId, tgtId, end, newId)` (chain-aware like `computeEdgeDeleteEdit`, refuses rather than guesses when the rewrite would touch a node-id token shared with a neighboring chain segment) wired through a new `edgeReconnected` postMessage → `handleEdgeReconnected` in `provider.ts`. **Not done**: true drag-from-endpoint-handle gesture — same class of DOM/geometry rewrite risk deferred elsewhere in this plan (steps 0.2, 3.1). 15/15 reducer tests pass (6 new), 8/8 patcher tests pass (from a prior session).
2. **Engine/IR/parser done; UI not started.** `EdgeStyle.via?: number[]` (flat `[x1,y1,x2,y2,...]`, no DSL grammar change needed — the parser's generic attr-block already supports flat scalar arrays) is read by a new `manualEdgeRoute(edge)` in `engine.ts`, spliced into `computeWaypoints`, applied post-layout via `applyManualEdgeRoutes` on all 4 `layout()`/`layoutAsync()` return paths, and short-circuits `routedWaypoints` past the router (new `clipRouteToNodes` helper in `edge-routing.ts`) so obstacle-avoidance doesn't discard the user's interior points. **Not done**: no UI to create/drag bend handles, and no "Reset route" context-menu item to delete `via` — an edge can only get a route today by hand-editing the DSL attr block.
3. ~~**Routing style per edge**...~~ **Engine/parser done, context-menu UI not started.** Parser now reads a `route:`/`routing:` attr key per edge (previously hardcoded to `'straight'` for every edge regardless of plugin default); all 10 diagram plugins (`flowchart`, `class`, `state`, `er`, `sequence`, `c4`, `bpmn`, `component`, `workitem`, `misc`'s generic/standalone plugins — 14 IREdge-construction sites total) now honor an explicit `ed.routing` override before falling back to their own unchanged default. **Not done**: no context-menu entry to set `route:` from the UI.
4. **Not re-verified after 4.2/4.3 landed.** The via-pinned-edge sub-case is handled (see 4.2). The original complaint — ordinary, non-via edges flattening to straight lines once any node is manually pinned — was not re-tested against the now-correct `ed.routing` defaults (most diagram types now default to orthogonal, which engages the manhattan router; this may already resolve the symptom as a side effect, but that hasn't been confirmed with a real compiled-diagram test).
5. **Partially done.** Two new engine tests added (`engine.test.ts`, "edge via/routing attrs" describe block, 4 tests total) covering: a `via` edge renders through its points, and per-edge `routing` override doesn't leak to other edges. **Not done**: the specific "routing still avoids obstacles after one node is pinned" scenario from this item's own wording — that needs a dedicated test distinct from the via-point tests already added.

**Step 5 — The rest of arch.md §9.4 that users will reach for.**
In rough priority: multi-select (marquee + Shift-click) and group drag; arrow-key nudge (1px / 10px with Shift); `Ctrl+D` duplicate; copy/paste; snap-to-grid + alignment guides (reuse the floorplan drag-guide code); change shape via context menu; group/ungroup (`Ctrl+G`) writing `group "…" { }` blocks; resize (writes `width`/`height`). Keybindings per arch.md §9.4.6 — add a `?` overlay listing them.

**Step 6 — Close the coverage gaps.**
Make implicit/structural elements editable: state `[*]`, mindmap indentation children (edit = re-indent), wireframe order-edges. Add an **edit-matrix test**: for every block in the demo galleries × every gesture (move, relabel, add, connect, reconnect, delete), apply the patch, recompile, and assert the expected IR change — replacing the hand-measured "26/29" with a number CI tracks.

**Step 7 — End-to-end smoke.**
One `@vscode/test-electron` suite that opens a `.sld` and a Markdown fence in the custom editor, posts drag/add/connect/undo messages to the webview, and asserts the document text. Slow — run on CI only, not in `npm test`.

### 3.3 Definition of done for the editor

- Every gesture in the table in arch.md §5.8.3 works for flowchart, class, ER, state, C4, BPMN, sequence.
- Undo/redo never loses a hand edit and matches the text editor's history.
- Arrows can be reconnected and bent, and the bend survives save/reload.
- Adding a node or edge never requires knowing the DSL.
- Client reducer, `EditSession`, and every patcher have unit tests; the edit matrix runs in CI.
- arch.md §5.4, §5.8.5, §9 describe the code that actually exists.

---

## 4. Priority 2 — smaller open items

- **Real-world fidelity corpora.** Both corpora are hand-curated. Add samples fetched from public repos (needs network access).
- **GitHub Action untested on a real runner.** Do one manual run in a scratch repo before anyone relies on it for CI.
- **Parser: two hardcoded diagram-type lists** (alias map + pre-check list). Collapse into one before the next type is added.
- **Parser: `containerDb` (and any other camelCase compound shape keyword) fails to parse.** `isShapeKeyword()`/`shapeKeywordToShapeType()` (`packages/core/src/parser/parser.ts`, ~line 411) only strip a `_Ext`/`_ext` suffix; found via the shipped `c4-container.sld` template and the Step 2 edit-vocabulary tests (2026-09-26). The edit vocabulary's C4-container "Database" kind works around it by emitting `container id: "…" "Database" "…"` instead of `containerDb`.
- **BPMN start/end events are inferred from edge topology**; a disconnected `(…)` stays `intermediateEvent`. Acceptable; document it in the user guide.
- **MCP `write_diagram`** refuses label-vocabulary types (gantt, charts, mindmap, gitgraph, sankey) and work items. Fine for now; revisit if agents need them.

---

## 5. Resist for now

**More diagram types.** 30+ `DiagramType` variants already. Breadth isn't the constraint; editor quality and distribution are. Adding type 31 is the most comfortable and least useful thing to do next.
