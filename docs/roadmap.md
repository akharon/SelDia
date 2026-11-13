# Roadmap

Open work only. Shipped work is in `git log` and the package READMEs; design intent is in [arch.md](arch.md). Every item below was checked against the code on 2026-11-13.

## Invariants every change must keep

- An unimportable Mermaid/PlantUML block falls back to the default fence. It never becomes a SelDiA error box in a document whose author did not ask for SelDiA (G3).
- Every visual edit is a minimal `WorkspaceEdit` on the source text. The source is the single source of truth; the document is never regenerated from IR.
- A visual edit that cannot be mapped to a source line is skipped with a visible message, never guessed.
- Layout changes are measured: the `layout-metrics` gate stays on, and the metrics run the same passes as the renderer ([reference.md](reference.md)).

## 1. Visual editor (priority)

The editor writes back through pure patchers with a serialized edit queue and a snapshot undo (`EditSession`). What is still missing:

- **Real VS Code verification.** Undo, add-node, draw-edge and reconnect are covered by unit tests, but nobody has driven the built VSIX by hand. Add one `@vscode/test-electron` suite (open a `.sld` and a Markdown fence in the custom editor, post drag/add/connect/undo messages, assert the document text). CI only, not in `npm test`.
- **Undo model.** Undo stacks are dropped on any hand edit and lost when the panel closes. Routing Ctrl+Z to VS Code's native undo was deferred because the block-mode interleaving case needs a real session to check.
- **Gestures that are menu-driven, not direct.** Edge endpoints can be reconnected only through the context menu; there are no hover connection handles or drag-from-handle. Adding a node inserts it immediately rather than waiting for a click-to-place ghost. Drag-node, label-edit and placing-node are still imperative DOM code in `webview/client/editor.ts`, outside `interaction-reducer.ts`.
- **Bend points.** The engine honors a per-edge `via` route and a `route:` attribute, but the editor has no bend-handle drag and no "reset route" or routing-style menu entry. An edge gets a route only by editing the DSL attribute block by hand. Also re-test that ordinary edges stay obstacle-avoiding once a node is pinned.
- **Editing conveniences.** No multi-select or marquee, group drag, arrow-key nudge, duplicate, copy/paste, snap-to-grid or alignment guides (the floorplan drag-guide code is the thing to reuse), change-shape menu, group/ungroup, or resize.
- **Coverage gaps.** State `[*]`, mindmap children and wireframe order-edges are not editable. Replace the hand-counted "26 of 29 demo blocks editable" with an edit-matrix test: every demo block times every gesture (move, relabel, add, connect, reconnect, delete), apply the patch, recompile, assert the IR change.
- **Session model.** `EditSession` holds source text and undo bookkeeping only; intent-to-`TextEdit` mapping still lives in `provider.ts`.

Done when: undo never loses a hand edit, arrows can be reconnected and bent and the bend survives reload, adding a node or edge never requires knowing the DSL, and the edit matrix runs in CI.

## 2. Smaller open items

- **Fidelity corpora are hand-written** (9 Mermaid, 7 PlantUML). Add samples taken from real public repos.
- **GitHub Action** (`.github/actions/seldia-render`) has not been run on a real runner. Do one manual run in a scratch repo before anyone relies on it.
- **Parser keeps two hardcoded diagram-type lists** (`TYPE_ALIASES` and the `diagramTypes` pre-check in `packages/core/src/parser/parser.ts`). Collapse them into one before the next type is added; forgetting one silently drops the type keyword.
- **`seldia md2pdf` is a stub.** The CLI command only checks the file exists and prints instructions. Real PDF export exists only in the VS Code extension (Markdown to PDF command and Marp export). Either implement it in the CLI or remove the command.
- **`seldia compile`** writes SVG only; the `--help` text still advertises PNG/PDF/HTML. Fix one or the other.
- **BPMN start/end events** are inferred from edge topology; a disconnected `(...)` stays an intermediate event. Document it in the user guide.
- **ELK post-compaction** of layered layouts was deferred as too costly for its gain.

## 3. Resist for now

More diagram types. There are already 35 `DiagramType` values, and breadth is not the constraint; editor quality and distribution are.
