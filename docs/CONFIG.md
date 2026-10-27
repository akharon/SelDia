# Configuration Reference

Quick guide to all configuration files in SelDiA.

---

## Configuration Files

| File | Purpose | Key Settings | Notes |
|------|---------|--------------|-------|
| `package.json` | Monorepo root dependencies | workspaces, scripts | pnpm workspace config |
| `pnpm-workspace.yaml` | pnpm workspace definition | packages list | Monorepo structure |
| `turbo.json` | Turbo build orchestration | pipeline, caching, tasks | Parallel build config |
| `tsconfig.base.json` | Shared TypeScript config | target, strict mode, paths | All packages extend this |
| `packages/*/tsconfig.json` | Per-package TS config | Extends base | Package-specific overrides |
| `.eslintrc.json` | Linting rules | rules, extends | Code quality |
| `.prettierrc.json` | Code formatter | printWidth: 100, semi: true | Consistent style |
| `packages/vscode-ext/package.json` | VS Code extension manifest | displayName, activationEvents, commands | Extension config |

---

## Critical Configuration Points

### IR Contract (G1 Rule)
- **All transformations read from IR, never raw AST**
- Enforced by TypeScript interfaces in `packages/core/src/ir.ts`
- **Violations caught by**: Linter (eslint) + tests
- **To verify**: Run `npm run lint` — flags any direct AST access

### Plugin Lifecycle Order (G2 Rule)
- **Fixed sequence**: Types → Parser → Engine → Renderers → Exporters
- **Defined in**: `packages/core/src/plugin-registry.ts`
- **Cannot reorder**: Architectural constraint built into system

### Fidelity Per-Renderer Documentation (G4 Rule)
- **Location**: `packages/*/README.md` or `docs/renderers/*.md`
- **Mermaid fidelity**: Lossy (9-sample corpus tested); see `packages/mermaid-renderer/FIDELITY.md`
- **PlantUML fidelity**: Better than Mermaid; nearly lossless for class/sequence
- **To document fidelity**: Add `FIDELITY.md` in each renderer package

### Build Configuration (Turbo)
- **`turbo.json`**: Defines task parallelization
- **Caching**: Results cached to `.turbo/`; disable with `--no-cache` if needed
- **Pipeline**: `build` → `test` → `lint` sequence

---

## How to Modify Common Configurations

### Add New Package to Monorepo
```yaml
# Edit pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'packages/new-feature'  # Add here

# Or via pnpm:
pnpm add @seldia/new-feature --workspace
```

### Change TypeScript Strictness
```json
// Edit tsconfig.base.json under "compilerOptions"
{
  "strict": true,          // Enforce all strict checks
  "noImplicitAny": true,   // Disallow implicit 'any'
  "strictNullChecks": true // Null/undefined checking
}
```

### Add New Renderer Plugin
```json
// Edit packages/vscode-ext/package.json under "contributes"
{
  "contributes": {
    "commands": [
      {
        "command": "seldia.renderMermaid",
        "title": "Render as Mermaid"
      },
      {
        "command": "seldia.renderMyRenderer",  // Add here
        "title": "Render with My Plugin"
      }
    ]
  }
}
```

### Update Linting Rules
```json
// Edit .eslintrc.json under "rules"
{
  "rules": {
    "@typescript-eslint/explicit-function-return-types": "error",
    "prefer-const": "warn"
  }
}
```

---

## Layout Engine Settings

Set in `packages/core/src/config.ts` (`DEFAULT_CONFIG`), and overridable per engine via `createEngine({ config })`.

| Key | Default | Purpose | Where |
|-----|---------|---------|-------|
| `layoutEngineByType` | `auto` for `flowchart`; `elk` for `class`, `state`, `component`, `network`, `block`, `workitem`; `dagre` for the rest | Per-type auto-layout engine. Consulted after a diagram's own `layout` line and before `defaultLayoutEngine`. Custom-layout types ignore it. Values: `dagre`, `elk`, `auto` (see `autoMaxNodes`) | `packages/core/src/config.ts` |
| `elkWhenGrouped` | `true` | A diagram that would default to `dagre` and has a group with members uses `elk` instead. An explicit `layout` line still wins. Also governs `auto`: a grouped diagram is not compared, it goes to `elk` (or `dagre` when this is `false`) | `packages/core/src/config.ts` |
| `autoMaxNodes` | `60` | `auto` engine only: a diagram with more nodes than this skips the comparison and uses a single ELK layout; a diagram with fewer than 2 edges uses dagre. Corpus cost of `auto` on flowcharts is about +1.2-1.4x total compile time (largest corpus flowchart is far below 60 nodes) | `packages/core/src/config.ts` |
| `autoMaxEdges` | `120` | `auto` engine only: a diagram with more edges than this also skips the comparison and uses a single ELK layout | `packages/core/src/config.ts` |
| `autoVariantMaxNodes` / `autoVariantMaxEdges` | `30` / `60` | `auto` engine only: diagrams within both limits try four layouts (dagre network-simplex and longest-path, ELK BRANDES_KOEPF and NETWORK_SIMPLEX); with <= 36 edges also up to three more (dagre tight-tree, ELK longest-path-source, and with <= 16 nodes ELK semi-interactive), then a median/barycenter sweep and a neighbour-swap pass whose try budget is `min(60, 900/edges)` (the top 3 variants are refined only with <= 16 nodes and <= 24 edges); larger diagrams under `autoMaxNodes`/`autoMaxEdges` try one dagre and one ELK; diagrams over those use a single ELK layout (thoroughness 3), since dagre's ordering is superlinear on dense graphs. Score order: gated defects (an edge over `DS.maxBendsPerEdge` counts as one), `crossings * crossingBendWeight + bends`, rank-skip penalty, routed length | `packages/core/src/config.ts` |
| `DS.crossingBendWeight` | `8` | `auto` engine and the refine passes: one edge crossing costs this many bends in the layout score (`crossings * weight + bends`, after gated defects). Raise it to prefer fewer crossings at the price of more bends | `packages/core/src/render/design-system.ts` |
| `edgeStyle` | `clean` | `clean` = rounded orthogonal edges with line jumps and hover highlight; `sketch` = hand-drawn rough edges | `packages/core/src/config.ts` |

## Build Profiles

**Development** (default):
```bash
npm run dev  # Watch mode, fast builds, source maps
```

**Production** (optimized):
```bash
npm run build  # Minified, no source maps
npm run package  # Package .vsix extension
```

**Testing**:
```bash
npm run test  # Vitest suite
npm run lint  # ESLint + Prettier
```

---

## Monorepo Structure

```
packages/
  core/           # IR, parser interface, engine
  cli/            # Command-line interface
  interaction/    # LSP, linting, validation
  vscode-ext/     # VS Code extension host
  web/            # Web UI
  mermaid-renderer/
  plantuml-renderer/
  c4-renderer/
```

Each package has its own `package.json`, `tsconfig.json`, and `README.md`.

---

**Last updated:** 2026-09-15
