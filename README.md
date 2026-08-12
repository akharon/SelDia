# SelDiA — Self-Diagramming Architecture

**The diagram engine. Keep your Mermaid — SelDiA keeps it true.**

Mermaid is a format. PlantUML is a tool. SelDiA is the *engine* underneath: it parses your diagrams into a real intermediate representation, renders them, validates them, and gives agents a way to query and maintain them as your system changes.

You don't have to rewrite anything. Keep writing Mermaid — keep your GitHub rendering, keep letting your AI generate it from memory. SelDiA runs it.

```
diagram flowchart "Login Flow" {
    start: (Start)
    validate: [Validate Credentials]
    decision: {Valid?}
    success: (Dashboard)
    failure: (Error)

    start --> validate
    validate --> decision
    decision -->|Yes| success
    decision -->|No| failure
}
```

*(The SelDiA DSL above is the engine's native format — its full power, for those who want it. It is not the price of admission.)*

## Why an engine?

Generating a diagram is solved and commoditized — every model writes Mermaid from memory. **Keeping a diagram true as the system drifts is not solved.** That takes an IR, diagnostics, and round-tripping: parse → structure → validate → write back. Mermaid is a parser bolted to a renderer; PlantUML is a Java monolith. Neither has the layer this needs. SelDiA does.

The wedge is *drift*, not drawing. See [docs/market.md](docs/market.md) for the full reasoning.

## Features

- 🔀 **Runs other formats** — Mermaid in, rendered through SelDiA's engine; export back out so it still renders natively on GitHub
- 🧠 **A real IR** — a typed intermediate representation between text and pixels, so diagrams are queryable and mutable, not just drawable
- 🤖 **Agent-facing** — LSP diagnostics mean a model can be told it's wrong and self-correct, instead of rendering garbage silently
- 🎨 **31 diagram types** — Flowchart, Sequence, Class, C4 (4 levels), BPMN, DMN, State, ER, Gantt, Mindmap, Sankey, Gitgraph, Work Items, and more
- ✏️ **Hand-drawn style** — Rough.js sketchy rendering, or smooth fallback
- 📐 **Smart layout** — Dagre hierarchical layout, d3-force for network graphs
- 🔧 **VS Code extension** — Syntax highlighting, LSP, live preview, interactive editing
- 📄 **Markdown integration** — Embed diagrams in `.md` files with ` ```seldia ` fenced blocks
- 📑 **PDF export** — Convert Markdown with embedded diagrams to professional PDF
- 🌐 **Web components** — `<seldia-viewer>` for embedding diagrams anywhere

## Packages

| Package | Description |
|---------|-------------|
| `@seldia/core` | Parser, IR, engine (layout + rendering), plugin system, all diagram plugins |
| `@seldia/cli` | CLI tools: `compile`, `validate`, `serve`, `init` |
| `@seldia/web` | Web components (`<seldia-viewer>`) |
| `@seldia/vscode-ext` | VS Code extension with full IDE integration |

> `@seldia/core`'s engine implements layout and Rough.js rendering inline; the
> former `@seldia/render` and `@seldia/layout` packages were unused and have
> been removed. `@seldia/interaction` is live — the VS Code extension's Edit
> mode uses it for zoom/pan, selection, and undo/redo.

## Quick Start

```bash
# CLI
npx @seldia/cli compile diagram.sld
npx @seldia/cli serve diagram.sld

# Or install globally
npm install -g @seldia/cli
seldia compile diagram.sld
seldia serve diagram.sld --port 8080
```

## Getting diagrams out of the editor

A diagram that only renders inside one editor's preview pane doesn't solve the
maintenance problem for a team — everyone touching the repo needs to see it,
not just people with the SelDiA extension installed. Two ways out:

**1. Render to SVG in CI.** The [`seldia-render`](.github/actions/seldia-render)
GitHub Action finds every `.sld` file and every ` ```seldia ` fenced block in
your Markdown, renders them through the same engine the CLI uses, and commits
the SVGs back — so diagrams show up as real images anywhere GitHub (or
anything else) renders an `<img>`, no viewer required. See
[`.github/workflows/render-diagrams.yml.example`](.github/workflows/render-diagrams.yml.example)
for a copy-paste workflow, or run it yourself:

```bash
npx @seldia/cli render . -o diagrams
```

**2. Embed live with `<seldia-viewer>`.** For pages that aren't rendered by
GitHub at all — internal docs sites, wikis, a runbook served from your own
app — `@seldia/web`'s `<seldia-viewer>` custom element compiles and renders
SelDiA DSL (or an already-committed `.sld` file, or Mermaid) directly in the
browser, no build step:

```html
<script type="module" src="https://unpkg.com/@seldia/web"></script>
<seldia-viewer src="/diagrams/architecture.sld" theme="sketchy-light"></seldia-viewer>
```

See [`packages/web/README.md`](packages/web/README.md) for the full API,
including loading from inline DSL vs. a URL and the live two-pane editor
component.

## Documentation

Full documentation at [seldia.dev](https://seldia.dev) (coming soon) or in the `docs/` directory.

## License

MIT
