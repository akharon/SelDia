# @seldia/render

**SelDiA rendering engine** — Rough.js SVG rendering, themes, shape factory, edge renderer.

Transforms IR (Intermediate Representation) diagrams into beautiful hand-drawn SVG using Rough.js, with smooth fallback.

## Features

- 🎨 **Rough.js sketchy rendering** — Hand-drawn aesthetic powered by Rough.js
- 🔲 **10+ shape implementations** — Rectangle, diamond, circle, cylinder, parallelogram, stadium, hexagon, and more
- 🔗 **Edge renderer** — Straight, spline, and orthogonal edge routing with arrowheads
- 🎭 **5 built-in themes** — `sketchy-light`, `sketchy-dark`, `blueprint`, `monochrome`, `clean`
- ✨ **Smooth fallback** — Clean non-Rough rendering option
- 📐 **Label renderer** — Text labels with auto-wrapping

## Installation

```bash
npm install @seldia/render
```

## Usage

```typescript
import { createRenderer } from '@seldia/render';

const renderer = createRenderer({ theme: 'sketchy-light' });
const svg = renderer.renderToSvg(irDiagram);
```

## License

MIT
