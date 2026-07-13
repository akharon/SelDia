# Getting Started

## Installation

### CLI

```bash
npm install -g @seldia/cli
```

Or run directly:

```bash
npx @seldia/cli compile diagram.sld -o output.svg
```

### VS Code Extension

Install **SelDiA** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=seldia.seldia-vscode-ext) for syntax highlighting, LSP, inline preview, and interactive editing.

### Library

```bash
npm install @seldia/core
```

## Quick Start

Create a file called `hello.sld`:

```
diagram flowchart "Hello World" {
    start: (Start)
    hello: [Hello]
    world: (World)

    start --> hello --> world
}
```

Compile it:

```bash
seldia compile hello.sld -o hello.svg
```

Open `hello.svg` in your browser — you'll see a hand-drawn flowchart!

## Next Steps

- Learn the [DSL syntax](/reference/dsl-syntax)
- Browse [diagram types](/diagrams/overview)
- Use the [VS Code extension](/guide/vscode-extension)
