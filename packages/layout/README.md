# @seldia/layout

**SelDiA layout engine** — Dagre hierarchical layout and d3-force for network graphs.

Provides a unified layout facade that selects the best algorithm for each diagram type.

## Features

- 📐 **Hierarchical layout** (Dagre) — Flowcharts, state diagrams, process flows
- 🔮 **Force-directed layout** (d3-force) — Network graphs, mind maps
- 🧩 **Grid layout** — Simple grid arrangement for ER diagrams and class diagrams
- 🏗️ **Extensible engine facade** — Easy to add new layout algorithms

## Installation

```bash
npm install @seldia/layout
```

## Usage

```typescript
import { createLayoutEngine } from '@seldia/layout';

const engine = createLayoutEngine({ type: 'dagre' });
const layouted = engine.layout(irDiagram);
```

## License

MIT
