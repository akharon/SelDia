# SelDiA Rendering & UI — Improvement Request

Scope: concrete quality problems in the rendered diagram output, its layout,
and the Markdown-preview toolbar/container chrome. Each item below states the
problem, exactly where in the codebase to verify it, how to reproduce it,
and what "fixed" should look like. No other document is required to act on
this.

Two cross-cutting themes run through items 3, 4, and 6: **each diagram type
must render with its own visual characteristics** (a class diagram must look
like a class diagram, a flowchart like a flowchart — not all identical
rounded boxes), and **layout must be legible** (no overlaps, sensible edge
routing, readable labels). The "Reference targets" section below pins those
themes to concrete visual examples.

---

## Reference targets (attached images)

These images were supplied as the quality bar. They are the acceptance
target for items 3, 4, and 6; described here in full so this document stays
self-contained.

**A — Rough.js gallery (aesthetic target for item 4).** Three framed shapes
from https://roughjs.com/ : (1) a solid red heart with a heavy, slightly
irregular black outline, sitting on a **blue cross-hatch** fill; (2) a solid
orange circle on a **blue diagonal-hachure** fill; (3) a **white grid-hachure**
diamond on a solid blue square. Key characteristics SelDiA does **not**
currently reproduce: real hachure / cross-hatch / grid fill patterns (visible
individual pen strokes, not a flat color wash) and thick, doubled, hand-drawn
outlines. A second image shows a Rough.js **bar chart** — bars with diagonal
hachure fill and sketchy outlines — proving the aesthetic is meant to extend
to data-viz diagram types too, not just freeform shapes.

**B — Mermaid UML class diagram "Animal example" (target for item 3, class
rendering).** What a class diagram must look like:
- Each class is a box of **three stacked compartments** separated by
  horizontal divider lines: a **bold, centered class name** on a tinted
  header (Animal, Duck, Fish, Zebra); an **attributes** compartment with
  left-aligned members (`+int age`, `+String gender`); an **operations**
  compartment with left-aligned methods (`+isMammal()`, `+mate()`).
- **Visibility markers** are preserved verbatim as the leading character of
  each member: `+` public, `-` private, `#` protected.
- **Relationship arrowheads are typed and distinct**: generalization
  (inheritance) uses a **hollow triangle** pointing at the superclass
  (Duck/Fish/Zebra → Animal); a dependency to the note uses a **dashed
  line**. (Association, aggregation/composition would use an open V and a
  diamond respectively.)
- A **note node** (yellow fill) is attached to Duck by a dashed connector
  ("can fly / can swim / …"), and a separate yellow **link-label box**
  ("From Duck till Zebra") annotates a relationship. Notes are a distinct
  node kind, not a regular class box.

**C — Mermaid flowchart (target for item 3 flowchart shapes + item 6
layout).** A top-to-bottom flow: `Start` (rectangle) → `Is it?` (**decision
diamond**) which branches into a **`Yes`**-labeled edge → `OK` → `Rethink`,
with a **back-edge** from `Rethink` up to `Is it?`, and a **`No`**-labeled
edge → `End`. Characteristics: the decision node is a real diamond (not a
rectangle); each branch edge carries a short label rendered on a **small
neutral background chip** so it stays readable where it crosses a line; the
back-edge is routed cleanly around the nodes rather than straight through
them; branches diverge left/right instead of stacking on top of each other.

---

## 1. Toolbar uses emoji instead of a real icon set

> **Icon source decided in item 5 below:** use Google Material Symbols
> (https://fonts.google.com/icons), vendored locally — not Codicons. The
> "two approaches" listed here are kept for the technical detail on *how*
> to wire icons into the webview, but the *which icon set* question is
> settled by item 5, not by this item.

**Problem.** Every button in the Markdown-preview toolbar is a raw emoji
character, not an icon glyph. Emoji rendering is inconsistent across OS/font
(Windows, macOS, and Linux render the same emoji differently, some as
monochrome, some as full color, some as a tofu box), doesn't respect the
VS Code theme's icon color, and doesn't visually match VS Code's own chrome
(which uses Codicons everywhere else). This is what makes the toolbar in the
attached screenshots look like a hobby prototype rather than an IDE-native
feature.

**Where.** `packages/vscode-ext/src/markdown-preview/plugin.ts`, in
`renderSelDiABlock()`. Exact emoji currently in use (grep
`grep -n "🔍\|⟲\|📥\|✎\|👁\|✏️\|📋\|⛶\|✓\|❌\|📐" packages/vscode-ext/src/markdown-preview/plugin.ts`):

| Line | Current | Button |
|---|---|---|
| 74 | `❌ SelDiA Error` | error badge |
| 75 | `✏️ Edit Source` | error-state edit link |
| 93 | `👁 Preview` | mode button |
| 94 | `</> Code` | mode button (already text, inconsistent with the emoji ones next to it) |
| 95 | `✎ Edit` | mode button |
| 104 | `⛶ Auto Layout` / `✓ Auto Layout` | auto-layout toggle |
| 105 | `🔍+` | zoom in |
| 106 | `🔍−` | zoom out |
| 107 | `⟲` | reset zoom |
| 108 | `📥` | export SVG |
| 117 | `✏️ Open in editor` | reveal source link |
| 118 | `📋 Copy` | copy source |

**What to do.** Replace every emoji above with a proper icon. Two acceptable
approaches, in order of preference:

1. **VS Code Codicons** (`$(icon-name)` syntax) — VS Code's built-in Markdown
   preview webview supports Codicons natively in HTML via the
   `codicon codicon-<name>` CSS classes once the codicon font/CSS is linked
   (VS Code ships `codicon.css`; it needs to be referenced from
   `markdown.previewStyles` in `packages/vscode-ext/package.json`, same
   mechanism already used for `./media/seldia-preview.css`). Suggested
   mappings: `codicon-eye` (Preview), `codicon-code` (Code),
   `codicon-edit` (Edit), `codicon-error` (error badge),
   `codicon-layout` or `codicon-refresh` (Auto Layout — needs a distinct
   glyph for "on" vs "off" state, e.g. `codicon-check` vs
   `codicon-layout`), `codicon-zoom-in`, `codicon-zoom-out`,
   `codicon-discard` (reset), `codicon-cloud-download` or
   `codicon-save-as` (export), `codicon-go-to-file` (open in editor),
   `codicon-copy` (copy source). This is the closest fit to "look native
   inside VS Code" since Codicons are exactly what VS Code's own UI uses.
2. **Google Material Symbols** (per the original request, fonts.google.com/icons)
   — self-host the relevant subset as an SVG sprite or inline `<svg>` per
   button (a strict CSP context like the Markdown preview cannot fetch a
   remote Google Fonts stylesheet at runtime, so the font/SVGs must be
   vendored into `packages/vscode-ext/media/` and referenced locally).

Either way: every button must have a `title` attribute for tooltip text
(already present) and must render identically regardless of host OS — no
raw Unicode emoji left in the toolbar.

**How to verify the fix.** Open any Markdown file with a ` ```seldia ` block
in the VS Code preview (`Ctrl+K V`). Every toolbar button should show a
crisp monochrome-style glyph matching VS Code's icon style (compare against
the icons in the file-explorer toolbar), not a colorful emoji. Test on at
least two OSes or two VS Code icon themes to confirm no OS-dependent emoji
rendering remains.

---

## 2. Node size is a fixed constant per diagram type — text overflows and overlaps

**Problem.** Node width/height are hardcoded constants, completely
independent of the label's actual text length or line count. When a label is
long or multi-line (very common for class-diagram members, e.g.
`"InteractionManager\n+attach(target: HTMLElement): void\n+detach(): void"`),
the text overflows the fixed-size box and visually overlaps neighboring
nodes and edges. This is exactly what the attached screenshots show — e.g.
the "Key Classes" screenshot where `actionManager`, `ZoomPanHandler`,
`SelectionManager` node labels run into each other, and the "Markdown
Integration Architecture" screenshot where `Markdown Document`, `Block
Detector`, `Core Engine` labels overlap across node boundaries.

**Root cause, with exact locations:**

1. **Fixed node sizes, never computed from content.** Every diagram-type
   plugin's `transform()` hardcodes `size: { width: X, height: Y }`
   regardless of `nd.label.length`:
   - `packages/core/src/diagrams/flowchart.ts:32` — `{ width: 100, height: 50 }`
   - `packages/core/src/diagrams/class.ts:32` — `{ width: 180, height: 100 }`
   - `packages/core/src/diagrams/bpmn.ts:22` — `{ width: 140, height: 60 }`
   - `packages/core/src/diagrams/misc.ts:20` — `{ width: 150, height: 60 }`
   
   None of these measure the label text (character count, longest line, or
   line count) to size the box. A class with 6 methods gets the exact same
   100×60 (or type-specific fixed) box as a class with one short name.

2. **`\n` in a label never becomes a line break in the rendered SVG.**
   `packages/core/src/engine.ts`, `renderNode()`, line 267-268:
   ```
   const label = this.esc(node.label || node.id);
   el += `<text x="${cx}" y="${cy + fs * 0.35}" text-anchor="middle" ...>${label}</text>`;
   ```
   This emits a single `<text>` element with the raw label string. SVG's
   `<text>` element does **not** treat `\n` as a line break — it is either
   collapsed to a space or ignored, so a label authored with `\n` separators
   (which is exactly how the class-diagram examples in `docs/arch.md`
   compose multi-line member lists, e.g. `"CoreEngine\n+compile(...): CompileResult"`)
   renders as one long horizontal run of text, centered on the node and
   overflowing it in both directions. There is no `<tspan>` splitting logic
   anywhere in the codebase (`grep -n "tspan" packages/core/src/engine.ts`
   returns nothing).

3. **Layout engines (dagre/elk) size their boxes from `node.size`, so the
   undersized fixed box also causes edges/other nodes to be placed too close
   together** — see `packages/core/src/layout/engines.ts`, both
   `layoutWithDagre` and `layoutWithElk` pass `n.size.width`/`n.size.height`
   straight into the layout algorithm's node-box dimensions. Since the box
   is undersized relative to the rendered (overflowing) text, the layout
   algorithm has no idea the visual footprint is actually larger, so it
   places neighboring nodes as if the small box were the true size —
   compounding the overlap.

**What to do.**
- Add text measurement (even an approximate monospace/average-character-width
  heuristic is fine — exact canvas-based measurement isn't available in a
  pure-Node SVG-string renderer, but a per-character-width table keyed by
  font size is a well-known, good-enough approach) and size each node's
  `width`/`height` from its label's longest line and line count, with a
  minimum floor equal to today's constants.
- Split labels on `\n` into one `<tspan>` per line inside `renderNode()`
  (`packages/core/src/engine.ts` around line 267-268), each `<tspan>` on its
  own `y` offset (`dy="1.2em"` per line is a common pattern), and grow the
  node height by `lineCount * lineHeight`.
- Re-run sizing **before** layout, not after — the layout engines
  (`packages/core/src/layout/engines.ts`) must receive the final measured
  size so spacing is computed correctly, not the fixed constant.

**How to verify the fix.** Render the "Key Classes" class diagram from
`docs/arch.md` §5.8 (or any class diagram with 2+ methods on a class) and
the "5.8.2 Markdown Integration Architecture" flowchart. Confirm: (a) every
`\n` in a label produces a real visual line break, not a run-on line: (b) no
two node boxes visually overlap; (c) no label text extends outside its own
node's border.

---

## 3. All diagram types render with identical, generic visual language

> **Acceptance target:** reference images **B** (class) and **C** (flowchart)
> above. "Fixed" means SelDiA's class output resembles B and its flowchart
> output resembles C — each type showing its own characteristics.

**Problem.** Every node **and every edge** falls through the same generic
rendering path regardless of diagram type — a class-diagram node, a
flowchart process box, and a generic block-diagram box are visually
indistinguishable (same fill color, same stroke color, same rounded-rect
shape, same lack of internal structure), and every edge is the same straight
line with the same filled-triangle arrowhead. UML class diagrams
conventionally have three stacked compartments (class name / attributes /
operations, separated by horizontal rules) with distinct typography per
compartment, note nodes, and typed relationship arrowheads; flowchart/
activity nodes conventionally use shape semantics (start/end ovals, decision
diamonds, process rectangles) with labeled branch edges. SelDiA currently
draws a class as one plain rounded rectangle with an unreadable run-on text
label (see item 2), and draws a flowchart decision the same as a process box
unless the author manually picks the `{diamond}` shape — there is no notion
of "this is a class diagram, render class semantics" anywhere in the render
path.

**Root cause, with exact locations:**

1. **`renderNode()` switches only on `node.shape` (a generic shape enum:
   `diamond`, `circle`, `hexagon`, `parallelogram`, `cylinder`, `actor`,
   `cloud`, `subroutine`, `stadium`, default-rectangle), never on
   `node.style`'s diagram type or any class-specific data.**
   `packages/core/src/engine.ts` lines 230-269. There is no `case` for a
   UML class compartment layout — a class node's `shape` is
   `ShapeType.RECTANGLE` (`packages/core/src/diagrams/class.ts:31`, falling
   back to `nd.shape || ShapeType.RECTANGLE`), which hits the exact same
   `default:` branch (line 264) that a flowchart process box or an ER
   entity box hits.

2. **No default fill/stroke differentiation per diagram type either.**
   Compare the plugins' `transform()`:
   - `packages/core/src/diagrams/class.ts:33` — `style: nd.style ? {...nd.style} : {}` — **no default fill/stroke set at all.**
   - `packages/core/src/diagrams/flowchart.ts:33` — same: `style: nd.style ? {...nd.style} : {}` — **no default fill/stroke.**
   - `packages/core/src/diagrams/bpmn.ts:22` — explicitly sets `fill: '#f0fdf4', stroke: '#166534'` (BPMN does get its own color).
   - `packages/core/src/diagrams/misc.ts:20` — uses per-type `defFill`/`defStroke` variables (varies by type).
   
   Since class and flowchart set no default style, both fall through to
   `renderNode()`'s hardcoded fallback at line 234: `fill: '#e8f4f8'`,
   `stroke: '#2c3e50'` — **byte-for-byte the same color for both diagram
   types**, which is precisely the complaint ("flowchart and class diagram
   both use same boxes, with same color").

3. **The IR (`IRNode`) has no concept of "compartments"** — `packages/core/src/ir/types.ts`
   `IRNode` has `label`, `description`, `style`, `data` but no structured
   field for a list of attributes/operations a UML class renderer could
   iterate over to draw separate compartments. The class plugin
   (`class.ts`) currently just concatenates everything into one `label`
   string (see item 2) instead of, e.g., populating `node.data.attributes`
   and `node.data.operations` as arrays.

4. **Every edge renders identically — routing and arrowhead type are both
   ignored.** `packages/core/src/engine.ts`, `renderEdge()` (lines 272-295):
   - It always draws a single straight `<polyline>` through the waypoints and
     always caps it with the **same filled-triangle arrowhead** (lines
     286-288). There is no hollow-triangle (generalization), open-V
     (association), or diamond (aggregation/composition) variant — so a UML
     class diagram's inheritance arrows are indistinguishable from a
     flowchart's flow arrows. `IREdge` has **no arrowhead-type field** at all
     (`grep -n "arrowhead\|arrowType\|marker" packages/core/src/ir/types.ts`
     finds only the boolean `arrowhead` that `class.ts:49` sets, which just
     means "draw an arrowhead," not "which kind").
   - `IREdge.routing` (`EdgeRouting.STRAIGHT|SPLINE|ORTHOGONAL|CURVED`,
     `packages/core/src/ir/types.ts:128-161`) is **read nowhere in
     `renderEdge()`** — `class.ts:50` sets `routing: EdgeRouting.ORTHOGONAL`
     and it is silently ignored; every edge is straight regardless.
   - The edge label is drawn as a bare `<text>` at the midpoint with **no
     background chip** (line 292), so it becomes unreadable wherever it
     crosses the line it labels — versus reference image C, where each
     `Yes`/`No` label sits on a small neutral background.

**What to do.**
- Give `IRNode` an optional structured field for class-like diagrams (e.g.
  `data.compartments: string[][]` — one array of lines per compartment) and
  have `class.ts`'s `transform()` populate it instead of flattening
  everything into `label`. Preserve the leading visibility marker (`+`/`-`/
  `#`) on each member verbatim, as reference image B shows.
- Add a distinct **note node kind** (yellow fill, no compartments, attached
  by a dashed connector) so class-diagram notes and link-labels render like
  reference image B rather than as ordinary boxes.
- Add a dedicated rendering branch in `renderNode()` (or a
  diagram-type-aware render dispatch, since `renderNode()` currently has no
  way to know which diagram type it's rendering for at all — it only
  receives `IRNode`/`IREdge`/bounds, not the diagram type; this needs to be
  threaded through from `renderToSvg()`, `packages/core/src/engine.ts:216`,
  which is called from `render()`, line 201, which has `layoutResult.diagram.type`
  available but currently drops it before calling `renderNode`) that draws:
  a name compartment, a horizontal divider line, an attributes compartment,
  another divider, an operations compartment — each compartment's lines
  rendered as separate left-aligned `<tspan>`s (reusing the multi-line fix
  from item 2).
- Make **flowchart shape semantics automatic** where the diagram type
  implies them (e.g. a node with two outgoing labeled edges reads as a
  decision → diamond) rather than requiring the author to hand-pick
  `{diamond}`, so a flowchart looks like reference image C by default.
- Add an **arrowhead-type field to `IREdge`** and honor it in `renderEdge()`
  with the distinct markers UML needs (hollow triangle, open V, diamond,
  plus the existing filled triangle); have `class.ts` set the correct type
  per relationship. Honor `IREdge.routing` in `renderEdge()` (at minimum
  implement `ORTHOGONAL` right-angle routing, since class/ER diagrams request
  it) instead of always drawing a straight line. Render edge labels on a
  small background chip (reference image C).
- Give each diagram type (or at minimum: flowchart, class, ER, state, BPMN)
  its own default `fill`/`stroke` pair in its plugin's `transform()`, the
  way `bpmn.ts` already does, instead of falling through to the one
  hardcoded default in `renderNode()`. A distinct, documented default
  palette per diagram type (not just "whatever `#e8f4f8`/`#2c3e50` happens
  to be") should be defined once (e.g. in `packages/core/src/themes.ts`,
  keyed by `DiagramType`) and referenced by every plugin, so diagram types
  stay visually distinguishable across all themes, not just the default one.

**How to verify the fix.** Render a class diagram and a flowchart from the
same `.md` file, side by side, and compare against reference images B and C.
Confirm: (a) they use different default colors; (b) the class diagram's
nodes show three visually separated compartments (name / attributes /
operations) with divider lines and preserved `+`/`-`/`#` markers, not one
run-on text block; (c) inheritance edges show a hollow-triangle arrowhead
distinct from a flowchart's flow arrow; (d) a flowchart decision renders as
a diamond with labeled branch edges whose labels sit on readable background
chips; (e) a flowchart process box still looks like a plain rectangle (no
compartments) — i.e. the two diagram types are visually distinct by design,
not just by accident of different box dimensions.

---

## 4. The "hand-drawn" (sketchy) look is a generic SVG filter, not Rough.js

**Problem.** The product is marketed around Rough.js's distinctive
hand-drawn aesthetic (see rough.js's own gallery — hachure fills, multiple
slightly-offset overlapping strokes per edge, irregular "sketchy" line
wobble that varies per shape), but the actual rendering path does not use
the `roughjs` library to draw a single shape. What's shown instead is a
uniform SVG `feTurbulence`/`feDisplacementMap` filter applied post-hoc to
ordinary geometric SVG shapes.

**Where.** `packages/core/src/engine.ts`, `renderToSvg()`, lines 221-223:
```
svg += `<defs><filter id="sketch"><feTurbulence type="turbulence" baseFrequency="0.03" numOctaves="2" result="noise"/>
  <feDisplacementMap in="SourceGraphic" in2="noise" scale="${sketchy ? 2 : 0}" .../></filter></defs>`;
```
This one `sketch` filter is referenced by every shape via `filter="url(#sketch)"`
(e.g. line 242 for diamonds, line 244 for circles, etc.) — it is the *only*
mechanism used for the "sketchy" look, and it's the same displacement amount
(`scale=2`) for every shape in every diagram, which is why the result looks
flat/uniform rather than genuinely hand-drawn.

**The real Rough.js library is present in the repo but not wired into this
render path at all:**
- `roughjs` is a dependency of `packages/render/package.json:32` and
  `packages/web/package.json:39` — **not** of `packages/core/package.json`,
  which is where `engine.ts`'s actual SVG-emitting code lives.
- `grep -rln "@seldia/render" packages/*/src` returns only
  `packages/render/src/index.ts` itself — no other package imports
  `@seldia/render`. It is dead code; nothing in the shipped extension or CLI
  ever calls into it. (This mirrors a finding already on record in
  `docs/review-2026-07-14.md` §3.1 — the render/layout/interaction packages
  are unused by the engine that actually ships.)

**What to do.** Either:
- (a) Add `roughjs` as a direct dependency of `packages/core`, and replace
  the SVG-primitive drawing calls in `renderNode()`/`renderEdge()`
  (`packages/core/src/engine.ts` lines 230-296) with calls to Rough.js's
  `rough.svg(...)` shape generators (`generator.rectangle()`,
  `generator.polygon()`, `generator.ellipse()`, `generator.line()`, etc.),
  which natively produce the hachure-fill, multi-stroke, per-shape-seeded
  wobble effect the product is supposed to have — then delete the
  `feTurbulence` filter entirely since it becomes redundant; or
- (b) if keeping the dependency-free filter approach is intentional for
  bundle-size reasons, at minimum vary the filter's `baseFrequency`/`scale`/
  `seed` per-node (currently identical for every shape,
  `packages/core/src/engine.ts:222`) so repeated renders of the same
  diagram don't look mechanically uniform, and make this an explicit,
  documented tradeoff rather than an accidental one.
Option (a) is the one that will actually deliver "looks like the Rough.js
gallery," since the filter approach in the current code cannot produce
hachure fill patterns or multi-stroke line doubling — it can only wobble
the outline of an already-perfect vector shape.

**How to verify the fix.** Render any diagram with `sketchy: true` (the
default — `packages/core/src/config.ts`, `render.sketchy: true`) and
visually compare a filled rectangle against a shape from
https://roughjs.com/ 's gallery with the same `roughness` setting. The fill
should show visible hachure/cross-hatch line strokes (not a flat color
wash), and the outline should show the characteristic double/overlapping
stroke, not just a wobbly single outline.

---

## 5. Diagram container chrome should match native VS Code Markdown-preview look, and icons must come specifically from Google Material Symbols

**Problem.** The rendered `.seldia-diagram` block looks like a bolted-on
third-party widget rather than a native part of the Markdown document: it
draws its own heavy "card" chrome (rounded corners, a distinct toolbar
background band, its own border) that doesn't match how any other Markdown
element looks in VS Code's built-in preview — a table, a fenced code block,
or a blockquote in the same document all render with flat, minimal, theme-
integrated styling, not a rounded card with a colored header bar. This
compounds item 1: even after the emoji are replaced, if the icons aren't
drawn from the same icon set the rest of VS Code uses, and the container
keeps its current card styling, the diagram block will still visually stick
out from the surrounding Markdown content instead of reading as a native
part of the document.

**Where.**
- Container chrome: `packages/vscode-ext/media/seldia-preview.css`, rule
  `.seldia-diagram` (lines 9-15) — sets `border-radius: 10px` and a full
  `border` around the whole block, and `.seldia-diagram-toolbar` (lines
  18-28) — sets a distinct `background: var(--vscode-editor-
  inactiveSelectionBackground, #2a2a2a)` band with its own `border-bottom`,
  unlike a plain paragraph, table, or code fence, which have no such banded
  header in the built-in Markdown preview.
- Icons: as detailed in item 1 above
  (`packages/vscode-ext/src/markdown-preview/plugin.ts`), all toolbar
  buttons currently use raw emoji characters.

**What to do (clarifying / superseding item 1's icon choice).**
- **Icon source is Google Material Symbols specifically** — not Codicons,
  not any other icon set. Vendor the required subset of
  https://fonts.google.com/icons locally into
  `packages/vscode-ext/media/` (as an SVG sprite or a set of inline `<svg>`
  snippets — a strict-CSP Markdown preview webview cannot fetch
  fonts.google.com at render time, so the assets must ship with the
  extension, not be linked remotely) and use them for every button
  currently listed in item 1's table (Preview, Code, Edit, error badge,
  Auto Layout on/off, zoom in/out, reset, export, open-in-editor, copy).
  Match icon stroke weight/style to Material Symbols' "Outlined" variant by
  default, since that most closely matches the visual weight of VS Code's
  own Codicons and won't look mismatched sitting next to native VS Code
  chrome (the tab bar, the status bar, other extensions' toolbar buttons)
  even though it isn't literally the same icon set.
- **Container and toolbar styling should read as "native Markdown
  content," not as a bolted-on card.** Reduce the visual weight of
  `.seldia-diagram`'s own border/corner treatment and `.seldia-diagram-
  toolbar`'s distinct background band so the block sits in the document the
  way a table or fenced code block does — themeable via the same
  `var(--vscode-*)` tokens already used throughout
  `packages/vscode-ext/media/seldia-preview.css` (this part is already done
  correctly — every color in the stylesheet already reads from a
  `--vscode-*` custom property with a sensible fallback; the issue is the
  chrome/geometry choices, not the color source).

**How to verify the fix.** Open a Markdown file that has a `seldia` diagram
block directly above or below a Markdown table and a fenced (non-seldia)
code block, in the built-in preview. All three should share a consistent,
native visual weight — no one of them should look like an embedded
third-party widget next to the other two. Every icon in the diagram
toolbar should be traceable to a specific glyph on
https://fonts.google.com/icons (a code reviewer should be able to name the
Material Symbols glyph name for each button), not a Unicode emoji or a
different icon set.

Do not begin implementation for this item — this is a specification only.

---

## 6. Layout is not legible — spacing, routing, and label placement

> **Acceptance target:** reference images **B** and **C** above. Their
> layouts are legible (no overlaps, branches diverge, the back-edge is
> routed around nodes, labels stay readable). SelDiA's current output —
> visible in the attached "Key Classes" and "Markdown Integration
> Architecture" screenshots — has nodes and labels overlapping into an
> unreadable mass.

**Problem.** Even with a real layout engine now wired in (dagre synchronously,
elk asynchronously — see commit history / `packages/core/src/layout/engines.ts`),
the *result* is not legible. This is a compound of several causes, some of
which are the layout stage's own and some of which are upstream problems that
feed it bad input:

1. **Upstream: nodes are sized wrong before layout runs (item 2).** The
   layout engine positions boxes using `node.size`, but that size is a fixed
   constant that doesn't reflect the actual (often larger, overflowing) text
   footprint. So the engine packs neighbors as if boxes were smaller than
   they visually are → overlap. **Item 2 must be fixed for item 6 to be
   fixable** — correct sizing is a precondition for correct spacing.

2. **Upstream: edges ignore routing and cut straight through nodes (item
   3, cause 4).** `renderEdge()` draws a straight polyline through waypoints
   regardless of `IREdge.routing`, so even when the layout engine produces
   orthogonal bend points, or when an edge should route *around* an
   intervening node (like the `Rethink → Is it?` back-edge in reference C),
   the rendered line goes straight through whatever is in the way.

3. **Layout's own: the manual-mode fallback is a crude 3-column grid.**
   `packages/core/src/engine.ts`, `resolvePosition()` line 179:
   ```
   return { x: 100 + (index % 3) * 220, y: 100 + Math.floor(index / 3) * 120 };
   ```
   Because of the diagram-wide manual model (any one manual `{x,y}` disables
   the auto engine for the whole diagram), as soon as a user drags a single
   node, **every other node** falls back to this fixed 220×120 grid with no
   regard to edges or box sizes — which will itself overlap for any non-tiny
   label. A partially-manual diagram should still route edges and avoid
   overlaps for the un-pinned nodes, not drop to a naive grid.

4. **Layout's own: spacing and label space aren't tuned for the content.**
   Default spacing is `nodeSpacing: [80, 60]`, `rankSpacing: 80`
   (`packages/core/src/config.ts`), applied uniformly; edge labels are not
   accounted for in layout at all (the layout engine is given nodes and
   edges but no label dimensions), so a labeled edge (`Yes`/`No`,
   `extract source`, multiplicity strings) has no reserved space and its
   text lands on top of other geometry.

**What to do.**
- Fix items 2 and 3 first (they are preconditions), then re-evaluate layout.
- Honor `IREdge.routing` in `renderEdge()` so orthogonal/curved routing and
  the engine's computed bend points are actually drawn (see item 3).
- Replace the naive grid fallback in `resolvePosition()` so a
  partially-manual diagram keeps pinned nodes fixed but still auto-arranges
  and routes around the un-pinned ones (constrained layout), instead of
  dropping the whole diagram to a fixed grid. (This revisits the diagram-wide
  manual model — a per-node "pinned" model with constrained layout is what
  reference-quality tools do.)
- Feed edge-label sizes into the layout stage (dagre supports edge label
  dimensions; elk supports label nodes) so labeled edges reserve space and
  labels don't collide — pairing with the label-chip rendering from item 3.
- Tune per-diagram-type spacing/direction defaults (a class diagram and a
  flowchart want different rank/node spacing), keyed the same way as the
  per-type palette in item 3.

**How to verify the fix.** Render reference C's flowchart DSL (Start → Is it?
→ Yes → OK → Rethink → back to Is it?, No → End) and a multi-class class
diagram. Confirm against images B and C: (a) no two nodes overlap; (b) no
edge passes through a node it doesn't connect to (the back-edge routes
around); (c) branch edges diverge rather than stacking; (d) every edge label
is readable, not overlapping the line or another label; (e) dragging one node
does not scramble the rest of the diagram into a grid.

---

## 7. Node shapes are clipped when zoomed out

> **Acceptance target:** the attached "23 nodes · 22 edges · 660×980"
> screenshot shows node boxes with their top/left edges sliced off (only the
> lower-right portion of each box is visible) after zooming out. Zooming to
> any level must show every shape whole.

**Problem.** When the preview is zoomed out, node shapes are visually
clipped — the stroke/outline of each box is cut along the container edges
instead of the whole diagram scaling down inside the viewport.

**Root cause, with exact locations:**

1. **Zoom is a raw CSS `transform: scale()` on the `<svg>`, with no
   compensation to the layout box.** `packages/vscode-ext/src/markdown-preview/index.ts`,
   `setupZoom()` → `apply()` (lines 62-64):
   ```
   svg.style.transform = `scale(${s})`;
   svg.style.transformOrigin = 'top left';
   ```
   A CSS `transform` is painted *after* layout, so the element's layout box
   keeps its original (unscaled) size. The scaled-down SVG is then positioned
   and clipped against a layout box that no longer matches its visual size.
   Combined with the container's `overflow` and the SVG's `max-width: 100%`
   rule below, the visible area and the transformed content get out of sync,
   so parts of shapes fall outside the clipped region.

2. **The container clips (`overflow`) and the SVG is width-constrained.**
   `packages/vscode-ext/media/seldia-preview.css`: `.seldia-diagram` sets
   `overflow: hidden` (line 14); `.seldia-diagram-svg` sets `overflow: auto`
   (line 78); `.seldia-diagram-svg svg` sets `max-width: 100%; height: auto`
   (lines 81-85). A `max-width: 100%` combined with a CSS `scale()` transform
   and a clipping ancestor is exactly the combination that slices shape edges
   when the intrinsic SVG size (`width`/`height` attributes emitted at
   `packages/core/src/engine.ts:221`) is larger than the container.

3. **Stroke width is not scaled with zoom either** — because the transform
   scales the whole SVG uniformly, at low zoom the sketch-filter displacement
   and stroke widths shrink too, but that is secondary; the primary defect is
   the clipping.

**What to do.**
- Zoom by adjusting the SVG's `viewBox` (or an inner `<g transform>`
  wrapper) rather than a CSS `transform: scale()` on the element, so the
  layout box and the visual content stay consistent and nothing is clipped;
  or, if keeping the CSS transform, ensure the container reserves space for
  the scaled size (e.g. scale a wrapper whose dimensions track the scaled
  content) and drop the `max-width: 100%` / `overflow: hidden` interaction
  that causes the clip.
- Verify the emitted SVG uses a `viewBox` that tightly bounds all geometry
  including stroke width and the sketch-filter displacement margin (the
  filter can push pixels a few units outside the nominal shape bounds, which
  also needs padding in the `viewBox`/bounds computed at
  `packages/core/src/engine.ts` `computeBounds()` / `renderToSvg()`).

**How to verify the fix.** Open a large diagram (e.g. the 23-node one in the
screenshot), zoom out to minimum and back in through several steps. At every
zoom level, every node box must be fully visible with all four edges of its
outline intact — no shape sliced by the container or the viewport.

---

## 8. Editing a node (drag/move) blanks the whole preview

> **Acceptance target:** the attached screenshot shows an **empty "Preview
> arch.md" tab** after pressing Edit and moving one node. Editing a node must
> update that node in place and leave the rest of the document rendered.

**Problem.** In Edit mode, dragging/moving one node results in a blank
Markdown preview — the entire rendered document disappears instead of the
one edited diagram re-rendering.

**Likely root cause, with exact locations (needs confirmation during the
fix — the failure is at the host↔preview boundary, which this static
analysis can identify but not fully prove without running the webview):**

1. **The move writes back to the source file and forces a full preview
   re-render.** `packages/vscode-ext/src/edit/commands.ts`,
   `applyBlockTransform()` (lines 55-65): on a move it applies a
   `WorkspaceEdit` replacing the fence's source lines and then calls
   `await doc.save()`. Saving the `.md` triggers VS Code to re-run the whole
   Markdown preview (re-invoking the markdown-it fence renderer for every
   block). If that re-render throws for any block, or races with the
   in-flight edit, the preview can come back empty.

2. **The block identity changes the instant the source changes, so the
   post-edit preview can't re-associate the moved node.**
   `packages/vscode-ext/src/markdown-preview/plugin.ts`, `blockIdForSource()`
   (line 32) hashes the DSL source: `seldia-${hashCode(source)}`. Writing new
   `{ x, y }` into the block changes its source → changes its hash → changes
   `data-seldia-block`. Any preview-side state keyed on the old block id
   (`data-seldia-setup`, zoom map, drag handlers in
   `packages/vscode-ext/src/markdown-preview/index.ts`) is orphaned after the
   re-render, and if the re-render itself errored the container is empty.

3. **A move can produce an intermediate/edge-case DSL that fails to
   recompile.** `setNodePosition()` writes a flat `{ x, y }` style block; if
   the target node line has a form the writer doesn't round-trip cleanly (see
   the multiline / typed-node cases handled in `dsl-edit.ts`), the resulting
   block could fail `compileSync()` in the fence renderer. A thrown error in
   one fence during VS Code's preview render can blank the whole preview
   rather than just that block.

**What to do.**
- Reproduce with a minimal `.md` (one `seldia` block) and capture whether the
  blank preview correlates with (a) a compile error on the rewritten block,
  (b) the `doc.save()`-triggered full re-render, or (c) the block-id change —
  the three hypotheses above.
- Make the fence renderer defensive: a failure rendering one `seldia` block
  must render an inline error box for *that block only* and never blank the
  surrounding document (confirm `renderSelDiABlock()`'s error path in
  `packages/vscode-ext/src/markdown-preview/plugin.ts` is actually reached
  and returns valid HTML for every failure mode, including exceptions thrown
  outside the `result.ok` check).
- Avoid the forced full-document re-render / flicker on every drag: debounce
  or make the write-back not force an immediate `doc.save()` (or update the
  preview in place) so moving a node doesn't tear down and rebuild the entire
  preview.
- Ensure the moved node's edit round-trips: after `setNodePosition()`, the
  block must still `compileSync()` successfully for every supported node
  syntax (add coverage in `packages/vscode-ext/test/dsl-edit.test.ts`).

**How to verify the fix.** Open a `.md` with at least two `seldia` blocks and
some surrounding prose in the built-in preview. Enter Edit mode, drag a node
in one block, release. Confirm: (a) the preview does **not** go blank; (b) the
moved node's new position is reflected; (c) the other block and all
surrounding Markdown remain rendered; (d) if the edit ever produces invalid
DSL, only that one block shows an inline error box while everything else stays
rendered.

---

*This document is a specification only. Do not begin implementation of any
item above.*
