# @seldia/interaction

**SelDiA interaction primitives** — Zoom/pan, drag-drop, selection, collapse/expand, tooltips, ARIA, source maps, undo/redo.

Provides interactive editing capabilities for in-browser SVG diagrams.

## Features

- 🔍 **Zoom & Pan** — Scroll wheel zoom, Shift+drag or middle-mouse pan
- 👆 **Selection** — Click selection, Ctrl+click additive, rubber-band marquee
- ✋ **Drag & Drop** — Node repositioning with touch support
- 📦 **Collapse/Expand** — Toggle groups and C4 containers with animation
- 💬 **Tooltips** — Rich HTML tooltips with delayed show/hide, follow-mouse
- ♿ **ARIA Accessibility** — Screen reader labels, live region announcements, keyboard navigation
- 🔄 **Source Maps** — Bidirectional mapping between IR elements and DSL source
- ↩️ **Undo/Redo** — Configurable undo stack (default 50)

## Installation

```bash
npm install @seldia/interaction
```

## Usage

```typescript
import { InteractionManager } from '@seldia/interaction';

const manager = new InteractionManager({
  onNodeDragEnd: (nodeId, x, y) => { /* sync to source */ },
});

manager.attach(containerElement);
manager.setItems(selectableItems);
manager.registerGroup(collapsibleGroup);
```

## License

MIT
