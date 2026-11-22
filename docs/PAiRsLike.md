# PAiRS-like graphics for SelDiA

**Status: implemented (2026-11-22).** All three phases are in. Deviations from this plan:

- Sketch mode skips animation, because rough strokes have no dash.
- `Theme.overrides` is not used. Accents come from a palette remap instead.
- Plugin renderers that paint their own colours (for example C4) are not tinted.
- Trace width uses `DS.stroke.emphasis` instead of a new token.
- LSP and completion additions were made in `vscode-ext` and `web`.

The sections below are the original plan.

This plan brings the look and feel of the PAiRS Relations view into SelDiA: flowing animated edges, hover and selection that trace a path, tinted and glowing nodes. It targets the Markdown preview, the visual editor and the exported SVG.

**Verdict: worth doing, in three phases.** Phase 1 is cheap and needs no IR change. Phase 2 also closes a real Mermaid import gap. Phase 3 is optional polish.

---

## 1. What PAiRS actually does

PAiRS has no graph library. The source is `D:\Workspace\PAiRS\PAiRS\src\core\analyze\relationGraphHtml.ts` and `webviewTheme.ts`, about 500 lines of front-end code. The effect comes from five small techniques.

| Technique | How PAiRS does it | Size |
|---|---|---|
| **Flowing edge** | `stroke-dasharray:7 4; animation: flow .7s linear infinite`, with `@keyframes flow { to { stroke-dashoffset:-11 } }` | 3 lines CSS |
| **Animate only what matters** | Animation runs only on the highlighted path (`#stage.hl .edge.on`). Every other edge stays static and dims to `opacity:.14`, and nodes not on the path dim to `.42`. | ~10 lines |
| **Path trace** | `highlight(key)` walks parent pointers from the hovered node to the centre. It adds `.on` to those nodes and edges and `.hl` to the container. | ~10 lines JS |
| **Tinted kind-coloured nodes** | Fill is `color-mix(in srgb, var(--k) 15%, var(--bg))`. Each node has a 4px left accent in its kind colour, and a kind-coloured shadow on hover. The selected node gets a ring in `--vscode-focusBorder`. | CSS |
| **Theme-native colours** | Colours come from `var(--vscode-editor-background, …)` and the other `--vscode-*` variables, with fallbacks. A `body.vscode-high-contrast` override and `prefers-reduced-motion: reduce` turn all animation off. | CSS |

PAiRS also staggers a `pop` entrance animation by depth and pulses a glow on the centre node.

**Key design lesson:** PAiRS does not animate every edge all the time. Motion marks only the path you are looking at. That is why it reads as clear rather than busy, and SelDiA should keep that default.

---

## 2. Where SelDiA already stands

Most of the plumbing already exists. The gap is mainly CSS and one IR attribute.

- **Stable, targetable SVG.** Edges are emitted as `<g class="seldia-edge" data-seldia-edge-id data-src data-tgt>` with a single `<path>` in clean mode ([engine.ts:986](../packages/core/src/engine.ts#L986)). Nodes are emitted as `.seldia-node[data-seldia-node-id]`. Arrowheads and labels sit in separate layers that point back to their edge through `data-seldia-edge-ref`.
- **CSS inside the SVG has a precedent.** The engine already embeds a hover `<style>` ([engine.ts:991](../packages/core/src/engine.ts#L991)) that thickens the hovered edge and dims the rest with `svg:has(...)`. A flowing edge is the same mechanism with one more keyframe.
- **Markdown preview.** The extension contributes `markdownItPlugins`, `previewScripts` (`dist/seldia-preview.js`) and `previewStyles` (`media/seldia-preview.css`).
  - SVG is inlined into the preview DOM, so preview CSS and JS can reach every edge.
  - The client script already re-binds on `vscode.markdown.updateContent` ([index.ts:396](../packages/vscode-ext/src/markdown-preview/index.ts#L396)).
  - The preview's default (Strict) CSP allows inline `<style>` and `@keyframes`, and extension preview scripts run because they carry the nonce.
- **Visual editor.** It already has node and edge selection (`selectedEdgeId`, `CLICK_EDGE`), Select and Pan tools, and box select. It is missing only the trace and dim styling.
- **Missing pieces:**
  - No `@keyframes` and no `prefers-reduced-motion` handling anywhere.
  - Themes have no CSS or effects hook.
  - The Mermaid importer does not parse edge ids (`A e1@--> B`) or `e1@{ animate: true }`.
  - `docs/improve.md` L5 plans an animated re-layout, which is a different kind of motion. Its reduced-motion rule should be shared with this work.

---

## 3. Can it run in each output?

| Output | Hover/selection trace | Authored flowing edges | Notes |
|---|---|---|---|
| VS Code Markdown preview | ✅ preview script + CSS | ✅ | The preview fully re-renders on each edit, so scripts must use delegated listeners. They already do. |
| SelDiA visual editor (webview) | ✅ | ✅ | Full control: we own the CSP and the script. |
| Standalone `.svg` in a browser | ✅ CSS `:hover` only | ✅ | The embedded `<style>` survives, as the hover CSS already does. |
| GitHub README `<img src=x.svg>` | ❌ no pointer events | ✅ likely | CSS keyframes inside the file animate; scripts are stripped. Verify with one real README. |
| Marp / HTML export | ✅ | ✅ | Inline SVG behaves like normal DOM. |
| PDF / PNG / PPTX | ❌ | Static frame | The dashed line stays readable as a dashed line, which is an acceptable degradation under G3. |

---

## 4. Which diagrams should get it

Motion should mean *something moves along this edge*: control, messages, data, current or tokens. Structural relations get the trace highlight but not looping flow.

| Group | Types | Flow animation | Hover/selection trace |
|---|---|---|---|
| **Primary: flow semantics** | flowchart, activity, bpmn, state, sequence (messages), c4-context/container/component, deployment, network, cloud, component, workitem (dependencies), circuit (current direction) | ✅ authored, and on trace | ✅ upstream and downstream |
| **Special rendering** | sankey (animate the ribbon gradient offset, not the dashes), gitgraph (branch lines, on trace only) | Optional, later | ✅ |
| **Structural** | class, er, usecase, dmn, c4-code, block | ❌ no looping animation | ✅ neighbours only |
| **No edges** | gantt, mindmap, charts, timeline, wireframe, form, table, floorplan, pcb | ❌ | Node select only (existing) |

For sequence diagrams, flow animation fits the message arrows, not the lifelines. Animating a step-through of messages in order would be a separate future feature ("play"), similar to Mermaid 12's step animation.

---

## 5. Plan

### Phase 1: interaction trace (S, no IR change)

The goal is the PAiRS feel on hover and selection, in the preview and the visual editor.

1. **Shared stylesheet** `packages/core/src/render/flow-css.ts`. It exports one CSS string so the preview, the editor and SVG export do not drift apart.
   ```css
   .sd-trace .seldia-edge, .sd-trace .seldia-edge-head, .sd-trace .seldia-edge-label { opacity:.15; transition:opacity .15s }
   .sd-trace .seldia-node:not(.sd-on) { opacity:.4 }
   .sd-trace .sd-on { opacity:1 }
   .sd-trace .seldia-edge.sd-on path { stroke-width:2.6; stroke-dasharray:7 4; animation:sd-flow .7s linear infinite }
   @keyframes sd-flow { to { stroke-dashoffset:-11 } }
   .seldia-node.sd-sel > :first-child { filter: drop-shadow(0 0 4px var(--vscode-focusBorder, #3b82f6)) }
   @media (prefers-reduced-motion: reduce) { .seldia-diagram-svg-el * { animation:none !important; transition:none !important } }
   ```
2. **Trace logic** `packages/vscode-ext/src/markdown-preview/trace.ts`, about 80 lines, shared with the editor client.
   - Build adjacency from `data-src` and `data-tgt` on the `.seldia-edge` groups.
   - On node hover or click: mark the node, its in/out edges and its neighbours with `.sd-on`. Shift+click extends this transitively, upstream and downstream, as a "trace to root" like PAiRS. Add `.sd-trace` on the `<svg>`.
   - On edge click: mark the edge, its two endpoints, and its head and label through `data-seldia-edge-ref`.
   - Esc or a background click clears the trace.
3. **Hit area.** Clean edges are 1–1.5 px wide and hard to click. The client adds a transparent clone path to each `.seldia-edge` with `stroke-width:12`, `stroke:transparent` and `pointer-events:stroke`. This keeps exported SVG unchanged.
4. Hook into `index.ts` (preview) and `editor.ts` (editor; selection state already exists, so add the class toggles to the existing selection render).
5. **Clean up the old hover CSS.** Trace supersedes the edge hover `<style>` at engine.ts:991 in interactive hosts. Keep that style for standalone SVG.

*Done when:* hovering a node in the preview of `docs/examples/*.md` lights its edges with flowing dashes and dims the rest, and reduced motion shows the same highlight without movement.

### Phase 2: authored flowing edges in the IR (M)

The goal is persistent animation the author asks for, which survives into SVG export and GitHub, plus Mermaid fidelity.

1. **IR.** Add `animate?: boolean | 'slow' | 'fast'` to the edge style, with the same values as Mermaid. The renderer reads it from the IR, never the AST (G1).
2. **DSL.** Add an edge attribute `{ animate }` or `{ animate: fast }`, following the existing edge-attribute syntax. Optionally add an arrow sugar `~~>` for an animated directed edge (check for conflicts in parser.ts:163 first).
3. **Renderer** (engine.ts edge loop, around 1215, next to `dashed`, `dotted` and `thick`):
   - Add class `seldia-flow` (plus `seldia-flow-fast` or `seldia-flow-slow`) on the `.seldia-edge` group.
   - Add `stroke-dasharray` from `DS.dash.edge`, so the token lint stays clean.
   - When any edge animates, append the keyframes to the existing `<style>`, wrapped in `@media (prefers-reduced-motion: no-preference)`. With reduced motion the edge stays dashed and still.
   - Sketch mode (Rough.js) has no single path. Version 1 animates every stroke path in the group, or skips sketch mode; decide after a visual check.
4. **Mermaid import** (`import/mermaid.ts`): parse edge ids `A e1@--> B` and `e1@{ animate: true | animation: fast|slow }`. Today this degrades, so the change fixes a real fidelity gap (G3/G4).
   **Mermaid export:** emit the same syntax.
   **PlantUML:** no equivalent, so the edge falls back to dashed. Document that loss.
5. **Tests:**
   - Add a Mermaid corpus sample with `@{ animate: true }` to the round-trip tests.
   - Add a renderer test asserting `seldia-flow` and the reduced-motion wrapper.
   - Run the layout baseline; it should be unchanged because geometry is untouched.
   - Update the fixtures and fidelity rows in `docs/reference.md`.
6. **Docs:** add a row to the user_guide arrow table and a section on "Animated edges".

### Phase 3: a `glow` theme, the PAiRS look (M, optional)

The goal is the dark, tinted, glowing visual style as an opt-in theme, not a new default.

1. **Theme effects hook.** Add an optional `effects` field to `Theme` (`types/style.ts`). This is a render-stage concern, so the plugin lifecycle (G2) is unchanged.
   ```ts
   effects?: {
     flow?: 'none' | 'trace' | 'all';     // when edges animate (default 'trace')
     glow?: boolean;                      // feDropShadow filter on nodes and highlighted edges
     tint?: number;                       // node fill = color-mix(kind colour, bg) at this %
     accentBar?: boolean;                 // 4px left kind-colour bar on rectangular nodes
   }
   ```
2. **Themes** `glow-dark` and `glow-light` in `themes.ts`.
   - Palette from PAiRS: calls blue `#3b82f6`, extends amber `#f59e0b`, uses teal `#14b8a6`, writes red `#ef4444`, plus a fuchsia/violet accent.
   - Colours resolve through `var(--vscode-*, fallback)` so they follow the VS Code theme in the preview and stay correct in standalone export.
   - A per-type `overrides` entry maps semantic kinds (C4 person/system/container, BPMN task/event/gateway, state, …) to accent colours, the way PAiRS maps function/class/interface.
3. **Glow** uses one shared SVG `<filter>` (`feDropShadow`) in `<defs>`, which works in every SVG context, unlike CSS `box-shadow`. Apply it to highlighted and selected elements only. A filter on every node is expensive on large diagrams.
4. **No entrance animation in the preview.** The preview re-renders on every keystroke, so a `pop` stagger would replay while typing. Allow it only in the editor on first open, or after L5 (stable layout) makes animated re-layout meaningful.
5. Add a DSL directive: `theme glow dark`, alongside the existing `sketchy|smooth|mono [light|dark]`.

---

## 6. Risks and rules

- **Motion budget.** The default is `flow: 'trace'`: only hovered or selected paths move, plus edges the author marks `animate`. `flow: 'all'` exists for slides and demos only.
- **Accessibility.** Under WCAG 2.2.2, looping motion longer than 5 seconds needs a pause. Honour `prefers-reduced-motion`, and add a pause/play toggle to the preview toolbar and the editor for authored animations.
- **Performance.** Dash-offset animation is cheap for up to a few hundred edges. Above about 300 animated edges, cap at `trace` automatically. Skip the glow filter on more than 200 nodes.
- **Token lint.** Dash and stroke values must come from `DS.*`. The 2.6 trace width becomes a new `DS.stroke.trace` token rather than a literal.
- **Single CSS source.** The preview, the editor and SVG export import `flow-css.ts`, so they cannot drift apart.
- **Unverified, test early:**
  - GitHub `<img>` playback of a CSS-animated SVG.
  - Whether Marp PDF captures a sensible frame. The dashes should be at offset 0 for print: use `@media print { animation:none }`.

---

## 7. Effort and value

| Phase | Effort | Value |
|---|---|---|
| 1. Trace | ~1–2 days, ~250 LOC, client only | High. Exploring large flowcharts, C4 and BPMN in the preview becomes much easier, and it is the most visible part of the PAiRS feel. |
| 2. `animate` in IR | ~2–3 days | Medium–high. Gives Mermaid 11.5+ parity (closing an import gap), and animated SVG survives into READMEs and slides. |
| 3. `glow` theme | ~2–3 days | Medium. Aesthetic and demo appeal. Keep it opt-in. |

When work starts, move these three items into `docs/improve.md` as open work, and delete them there when done.
