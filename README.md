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
- 🎨 **30 diagram types** — Flowchart, Sequence, Class, C4 (4 levels), BPMN, DMN, State, ER, Gantt, Mindmap, Sankey, Gitgraph, and more
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

> `@seldia/render`, `@seldia/layout`, and `@seldia/interaction` exist in the tree but are **not wired into the shipped product** — `@seldia/core`'s engine reimplements layout and rendering inline. They're slated to be wired through or deleted; see [next_steps.md §3](docs/next_steps.md#3-known-technical-debt-carried-from-prior-internal-review).

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

## Documentation

Full documentation at [seldia.dev](https://seldia.dev) (coming soon) or in the `docs/` directory.

## License

MIT
