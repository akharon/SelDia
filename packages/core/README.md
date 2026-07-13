# @seldia/core

**SelDiA core package** — Parser, engine, types, plugin system.

This is the foundation of the SelDiA ecosystem. It provides:

- **Custom recursive-descent parser** — Parses the unified DSL into an AST for all 21+ diagram types
- **Semantic analyzer** — Symbol table, reference resolution
- **Plugin system** — Extensible plugin manager + registry for diagram types
- **IR (Intermediate Representation)** — Diagram-agnostic representation used by renderers
- **Engine facade** — `compile()` entry point: DSL → AST → IR → SVG
- **21+ diagram plugins** — Flowchart, Sequence, Class, C4, BPMN, State, ER, Gantt, Mindmap, and more
- **Diagnostics framework** — Error/warning reporting with source locations

## Installation

```bash
npm install @seldia/core
```

## Usage

```typescript
import { createEngine } from '@seldia/core';

const engine = createEngine();
const result = await engine.compile('diagram flowchart "My Diagram" { start: (Start) --> end: (End) }');

if (result.ok) {
  console.log(result.value.svg);  // Rendered SVG string
  console.log(result.value.ir);   // Intermediate Representation
} else {
  console.error(result.errors);   // Diagnostic[]
}
```

## Documentation

See [seldia.dev](https://seldia.dev) for full DSL reference and API docs.

## License

MIT
