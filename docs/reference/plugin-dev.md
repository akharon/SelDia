# Plugin Development Guide

SelDiA's plugin system allows you to add custom diagram types or extend existing ones.

## Plugin Interface

```typescript
interface DiagramPlugin {
    readonly type: DiagramType;
    readonly version: string;
    grammarExtensions?: string;
    astNodeTypes: Record<string, ASTNodeConstructor>;
    transform(ast: DiagramAST, config: SelDiAConfig): DiagramIR;
    getDefaultLayout(): LayoutOptions;
    getDefaultStyle(theme: Theme): Partial<Theme>;
}
```

## Example Plugin

```typescript
import type { DiagramPlugin, DiagramAST, DiagramIR } from '@seldia/core';

const myPlugin: DiagramPlugin = {
    type: 'my-diagram' as DiagramType,
    version: '1.0.0',
    astNodeTypes: {},
    transform(ast: DiagramAST): DiagramIR {
        // Transform AST nodes to unified Diagram IR
        return {
            id: 'my-diagram',
            type: 'my-diagram' as DiagramType,
            nodes: [],
            edges: [],
            groups: [],
            layers: [],
            metadata: {},
        };
    },
    getDefaultLayout() {
        return { engine: 'dagre', options: {} };
    },
    getDefaultStyle() {
        return {};
    },
};
```

## Registration

```typescript
import { createEngine } from '@seldia/core';

const engine = createEngine({
    plugins: [myPlugin],
});
```
