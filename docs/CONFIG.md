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
| `layoutEngineByType` | `elk` for `class`, `state`, `component`, `network`, `block`, `workitem`; `dagre` for the rest | Per-type auto-layout engine. Consulted after a diagram's own `layout` line and before `defaultLayoutEngine`. Custom-layout types ignore it | `packages/core/src/config.ts` |
| `elkWhenGrouped` | `true` | A diagram that would default to `dagre` and has a group with members uses `elk` instead. An explicit `layout` line still wins | `packages/core/src/config.ts` |
| `edgeStyle` | `clean` | `clean` = rounded orthogonal edges with casing, line jumps and hover highlight; `sketch` = hand-drawn rough edges (casing only) | `packages/core/src/config.ts` |

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
