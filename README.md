# SelDiA — Self-Diagramming Architecture

**A unified text-based Diagram-as-Code tool with hand-drawn Rough.js aesthetics.**

SelDiA lets you describe 21+ diagram types in a single, clean DSL and renders them as beautifully sketchy SVG diagrams. Built with TypeScript, powered by Rough.js.

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

## Features

- 🎨 **21+ diagram types** — Flowchart, Sequence, Class, C4 (4 levels), BPMN, State, ER, Gantt, Mindmap, and more
- ✏️ **Hand-drawn style** — Rough.js sketchy rendering, or smooth fallback
- 📐 **Smart layout** — Dagre hierarchical layout, d3-force for network graphs
- 🎭 **5 built-in themes** — Sketchy Light/Dark, Blueprint, Monochrome, Clean
- 🔧 **VS Code extension** — Syntax highlighting, LSP (diagnostics, completion, hover, go-to-definition), live preview, interactive editing
- 🔄 **Bidirectional sync** — Edit visually or in code; changes sync both ways
- 📄 **Markdown integration** — Embed diagrams in `.md` files with ` ```seldia ` fenced blocks
- 📑 **PDF export** — Convert Markdown with embedded diagrams to professional PDF
- 🤖 **Copilot skill** — Teach GitHub Copilot to write SelDiA DSL
- 🌐 **Web components** — `<seldia-viewer>` for embedding diagrams anywhere

## Packages

| Package | Description |
|---------|-------------|
| `@seldia/core` | Parser, engine, types, plugin system, all diagram plugins |
| `@seldia/render` | Rough.js SVG rendering, themes, shape factory |
| `@seldia/layout` | Layout engines (Dagre, d3-force) |
| `@seldia/interaction` | Zoom/pan, drag-drop, selection, collapse/expand, tooltips, ARIA |
| `@seldia/cli` | CLI tools: `compile`, `validate`, `serve`, `init` |
| `@seldia/web` | Web components (`<seldia-viewer>`) |
| `@seldia/vscode-ext` | VS Code extension with full IDE integration |

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
