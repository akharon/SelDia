# PlantUML support — status

Goal: SelDiA processes/uses PlantUML the same way it does Mermaid — a peer
input format with its own source→IR frontend (never lowered into SelDiA DSL
text), plus the return leg IR→PlantUML, wired through every consumer.

## Done

### Core

- **`packages/core/src/import/plantuml.ts`** (new) — `importPlantUml(source)`,
  `isPlantUmlSource(source)`, `detectPlantUmlType(lines, block)`.
  - Preprocessing: `@start…/@end…` wrappers, `'` and `/' … '/` comments, `!`
    preprocessor lines, `skinparam`/`style` blocks, notes (one-line and
    `end note`), legends, headers/footers, `hide`/`show`/`scale`/`autonumber`.
    `title` and `left to right direction` are lifted, not dropped.
  - **Type routing by scoring.** PlantUML has no per-diagram header keyword, so
    the body is scored against each family's signature and the winner routes
    (ties fall back to a fixed priority). This is what keeps a shared keyword
    (`actor`, `database`, `entity`) from hijacking the family.
  - Families: sequence (incl. `alt/else/opt/loop/par/group` → the sequence
    layout's `metadata.sequenceFragments`), class (members, stereotypes,
    multiplicities, packages→groups), ER (IE crow's-foot), use case, activity
    (modern `:action;` + `if/elseif/else/endif`, `while/endwhile`,
    `repeat`, `fork`/`split`, `partition`; **and** the legacy `(*) -->` form),
    component, deployment, state (composite states → groups), mindmap
    (`@startmindmap` + `@startwbs`), gantt (`@startgantt`, relative scheduling
    resolved in a second pass).
  - Shared arrow scanner handles decorations on both ends, direction hints
    inside the arrow (`-down->`), inline specs (`-[#red]->`), and legacy
    trailing labels (`-->[yes]`), while skipping quoted runs so `"0..*"` is
    never read as a dotted connector.
  - `resolveContainerRefs()` — a relation pointing at a container (which became
    an `IRGroup`) is redirected onto the container's representative child
    instead of manufacturing a phantom node; prefers a real substate over a
    `[*]` pseudostate.
  - Never throws; unparseable statements become diagnostics, non-diagram
    blocks (`@startjson`, `@startsalt`, …) yield no IR so callers can fall back.

- **`packages/core/src/export/plantuml.ts`** (new) — `exportPlantUml(ir)`,
  `isPlantUmlExportable(type)`. Covers every imported family plus flowchart;
  returns `null` for types with no PlantUML spelling (gitgraph, charts,
  wireframe…). Activity exports the legacy graph-shaped form deliberately
  (structured control flow is not recoverable from an arbitrary IR graph).

- **`packages/core/src/index.ts`** — exports the four symbols and the two types.

### Consumers

- **CLI** (`packages/cli/src/index.ts`): new `seldia plantuml <file>` render
  command, and `export --to plantuml|puml`. The mermaid command was refactored
  into a shared `registerImportRenderCommand` factory (behaviour unchanged).
- **MCP** (`packages/mcp/`): `isPlantUmlFile()` (`.puml/.plantuml/.pu/.iuml/
  .wsd`), `isImportedFile()`, `loadDiagram()` routes PlantUML (extension or
  content sniff, checked before Mermaid), `validateDiagram()` covers it, and
  `mutate_node`/`write_diagram` decline it as a read-only import source.
- **VS Code** (`packages/vscode-ext/`): ` ```plantuml ` / ` ```puml ` / ` ```uml `
  fences render through the engine in the Markdown preview (shared
  `renderImportedBlock` behind `renderMermaidBlock`/`renderPlantUmlBlock`, same
  degrade-to-default-fence contract); `seldia.exportToPlantUml` command
  (`makeExportCommand` factory), CodeLens "Export to PlantUML", and the
  package.json command / menu / palette entries.

### Tests

- `packages/core/test/plantuml-import.test.ts` — 45 tests.
- `packages/core/test/plantuml-export.test.ts` — 25 tests (syntax assertions +
  import→export→import structural round trips).
- Both green; `npm run build` green across all 6 packages.

## To do

1. ~~**Run the full test suite**~~ — done. Two stale CLI expectations fixed:
   `export.test.ts` used `--to plantuml` as its example of an *unsupported*
   target (now `graphml`), and `export-semantic.test.ts` asserted the exact
   target list `mermaid, bpmn, sql-ddl` (now includes `plantuml`). Nothing in
   the cli/mcp/vscode-ext refactors was actually broken. Root `npm test` green:
   12/12 tasks.
2. ~~**Consumer-level tests**~~ — done, 6 added, all green:
   - `plugin.test.ts`: a ` ```plantuml ` fence renders with
     `data-seldia-source-format="plantuml"`, plus an `@startjson`/```puml case
     asserting the degrade-to-plain-fence contract (the PlantUML twin of the
     Mermaid `journey` fallback test).
   - `mcp/test/tools.test.ts`: `.puml` loads to non-empty IR and validates; a
     `.puml` write is declined (read-only import source).
   - `cli/test/export.test.ts`: `export --to plantuml` and the `puml` alias
     both emit `@startuml`/`@enduml`.
3. ~~**Visual verification**~~ — done. Rendered activity/component/state/
   sequence to PNG (`cairosvg`, per the packaging memory) and looked at them.
   - **sequence-with-fragments: correct.** Lifelines, actor styled distinctly,
     the ALT box with both `[valid credentials]` and `[invalid]` compartments
     split by the dashed else-divider, arrow order and directions all right.
   - **component: correct.** packages→groups nested and separated, UML port
     tabs, `database`→cylinder, `«component»`/`«service»` stereotypes.
   - **activity: structurally correct.** Both if-branches, yes/no decision
     labels, the while back-edge, distinct start/stop terminals. The `no`
     branch rejoins at the `More shipments?` decision rather than after the
     loop — an artifact of flattening PlantUML's implicit merge to a graph,
     consistent with the documented activity limitation.
   - **state: found a real bug, see below.**
4. ~~**File-type support in VS Code**~~ — closed as a deliberate no-op (user
   decision 2026-08-11). The premise was wrong: `.mmd` gets **nothing** today —
   the extension registers only `.sld` (one `languages` entry, one
   `customEditors` selector). Mermaid support is fences + CLI only, so leaving
   `.puml` unassociated is parity, and registering it alone would make the two
   import formats inconsistent.
5. **Docs**: README/docs mention Mermaid as the import format; add PlantUML
   (supported families, the `plantuml` CLI command, the fence languages).
   Consider a `demo_plantuml.md` alongside `demo_mermaid.md`.
6. **Fidelity corpus** — IN PROGRESS. 7 fixtures written to
   `packages/core/test/fixtures/plantuml-corpus/`: sequence-oauth, class-domain,
   component-microservices, er-billing, state-connection, activity-release,
   usecase-support. The test file itself
   (`packages/core/test/plantuml-fidelity.test.ts`, mirroring
   `mermaid-fidelity.test.ts`'s three checks: zero diagnostics + structural
   assertions + real SVG render) is **not yet written** — next step.

   It paid off immediately: probing the 7 fixtures found **4 real bugs** the 45
   unit tests missed. sequence-oauth / usecase-support / er-billing were clean
   apart from #4.

   - **(1) FIXED — state machine misrouted to `sequence`.** `state-connection`
     scored SEQUENCE over STATE, dropping the composite state entirely and
     collapsing every `[*]` into one shared node. Cause: a labelled transition
     (`Idle --> Sending : write()`) matches `SEQ_MESSAGE_RE`, so transitions
     out-number pseudostates and SEQUENCE wins the priority tie-break. Fix in
     `detectPlantUmlType`: `[*]` now vetoes SEQUENCE outright, mirroring the
     existing crow's-foot→ER guard. Now routes to `state`, 0 diagnostics,
     `state-Connected` group correct, `__start_0`/`__start_1`/`__end_0` distinct.
   - **(2) FIXED — `extends` / `implements` were unparsed.**
     `class Customer extends Entity` became a *node named*
     `Customer_extends_Entity` plus a phantom duplicate `Customer`, with no
     inheritance edge. `parseElementDecl` now peels
     `extends`/`implements` (comma lists, both keywords) into `decl.supers`,
     and `importClass` emits the same edge `Bar <|-- Foo` would
     (arrowhead at parent; realization dashed). class-domain: 10 nodes → 7,
     3 correct inheritance edges.
   - **(3) OPEN — `[X] <<stereotype>>` unrecognized (component).**
     `[Gateway] <<service>>` yields "Unrecognized statement" (4 diagnostics in
     component-microservices) and the `Services` package group comes out
     **empty**, its members escaping to the top level. The `[...]` shorthand
     branch in `parseElementDecl` has no stereotype handling, unlike the
     `parseNameAndAlias` path. Note the visual-verification sample rendered
     `<<service>>` fine because it used the `[X] <<s>>` form *inside* a
     different code path — worth re-checking which spellings work.
   - **(4) OPEN — `<<PK>>`/`<<FK>>` stripped to `<>` in ER attributes.**
     `* id : uuid <<PK>>` renders as `* id : uuid <>`, losing the key marker.
     Something is treating `<<…>>` as a stereotype to strip inside member/
     attribute text, where it should be kept verbatim.

   NOTE: a probe suggested `metadata.title` was dropped for every fixture —
   that was a probe error, not a bug. Title is set as `ir.title` and is
   correct (verified: "Release process", "OAuth 2.0 Authorization Code Flow").

## Group-layout bug — FIXED (2026-08-11)

Rendering the composite-state sample drew `Idle` **inside** the `Running` box
though it was a top-level sibling; the microservices sample was worse, putting
the entire `Data` package inside `Services`.

The importer was never at fault — its IR was exactly right. The fault was
engine-level and pre-existing, stated outright by the old comment on
`SelDiAEngine.layoutGroups`: *"Groups have no independent layout of their own
— they're a bounding box drawn around wherever their member nodes ended up."*
Dagre was constructed with `compound: false` and never told about membership,
so it could place a non-member between two members and the post-hoc bounds
union then enclosed it.

**Fix:** `applyClusters()` in [`layout/engines.ts`](packages/core/src/layout/engines.ts)
registers each `IRGroup` as a real dagre cluster and parents its member nodes
into it, with compound mode enabled only when the IR actually has groups
(it changes dagre's ranking even with no clusters set). Details that matter:

- A node is assigned to **at most one** parent — the innermost group claiming
  it, by depth in the `childGroupIds` forest — because dagre's parent tree
  admits no multiple parenthood.
- Clusters are registered shallowest-first, since a parent cluster must exist
  before a child is parented into it.
- Empty groups are skipped (dagre throws on an empty cluster).
- A group id colliding with a real node id **bails out** of clustering
  entirely, rather than letting dagre treat the node as the container and
  reading the node's geometry off a container rect.

The post-hoc `layoutGroups()` bounds pass is deliberately kept: dagre's own
cluster rects don't account for the header and padding this renderer draws.

Verified three ways: an intruder check over four corpus fixtures (zero, was
four), the full monorepo suite (12/12 tasks green), and rendering both samples
to PNG and looking at them. Covered by
[`group-layout.test.ts`](packages/core/test/group-layout.test.ts) — 5 tests,
including one on a **native DSL** group, since groups are engine-wide and not
a PlantUML feature.

*Cosmetic leftover, not fixed:* a group box can carry dead space below its
members (visible on `Services`), because the bounds union covers the cluster's
full extent. Purely visual, unrelated to the containment bug, out of scope here.

## Known limitations (intentional, worth recording)

- A transition aimed at a composite state / container is redirected to a child,
  so `Idle --> Running` becomes `Idle --> Working` when `Running` is composite.
- Activity export uses legacy syntax, so an export→import round trip loses the
  structured `if/endif` spelling (the graph is preserved).
- Gantt labels carry no year (the layout's label vocabulary has none), so an
  export of IR that did not come from this importer assumes the current year.

## Remaining work — all cleared (2026-08-11)

Every item in the queue is done:

1. **Bugs 3 & 4** — `[X] <<stereotype>>` and `<<PK>>`/`<<FK>>`. Bug 3 needed two
   fixes: the shorthand regexes were anchored so the decoration tail could never
   match, and once that parsed, `put()` was found discarding the stereotype so
   kind resolution still fell back to guessing from the name.
2. **`plantuml-fidelity.test.ts`** — 24 tests over the 7-fixture corpus, one
   named regression per bug, plus a guard that a relation line starting with a
   bracketed element still parses as an edge (the loosened regexes' risk).
3. **Docs** — `demo_plantuml.md` (11 families, verified block by block) and a
   PlantUML section in [`docs/next_steps.md`](docs/next_steps.md). Both
   galleries were shipped **unguarded**; `demo-imports.test.ts` now compiles
   every block in `demo_plantuml.md` *and* `demo_mermaid.md`.
4. **Mermaid cross-month gantt** — one-line fix in `importGantt()`, which now
   spells out the end month when a task crosses a boundary.
5. **Group layout** — above.

Three test expectations changed with the code, each for a stated reason: the ER
`*` marker test (the marker is now dropped — left in, `sql-ddl`'s `parseAttr()`
emits a column named `_`), and two fidelity assertions I wrote against the wrong
convention (composition is stored decorated-end-as-target; a composite state is
a group, so transitions naming it are redirected onto its inner start state).
