# SelDiA Codebase Guide

## Session preferences

- Keep chat responses silent/minimal to save tokens — avoid narration, progress updates, or verbose explanations unless asked.
- Use `/pairs` skill for code navigation instead of Read/grep — saves 40-60% of lookup tokens.
- Batch independent Read/Edit/Bash calls together to reduce round-trips.
- Trust diffs on edits — never ask to verify changes after Edit tool succeeds.
- Ask for specific line ranges when reading large files, not whole files.
- Reference code by `file:line` markdown links instead of quoting content.
- **Keep test/diagnostic output token-optimized** — run tests/scripts in quiet or summary mode, avoid verbose/debug logging flags, and don't dump full logs into chat; report pass/fail counts and only the relevant failure excerpt.
- **Save project context to memory** → `/home/mkyr/.claude/projects/-home-mkyr/memory/` (e.g., architectural decisions, common patterns, token optimizations learned).

---

## Quick Summary

**SelDiA** (Self-Diagramming Architecture) is a unified diagram engine: Mermaid/PlantUML/SelDiA DSL → intermediate representation → 31+ diagram types (flowchart, sequence, class, C4, BPMN, etc.) with LSP, validation, and round-trip export. Thesis: drift is the unsolved problem—keeping diagrams true as systems evolve requires an IR, not just generation.

---

## Reading Order

Four docs besides `docs/examples/`:

1. **User guide**: [docs/user_guide.md](docs/user_guide.md) — How to use DSL, CLI and the VS Code extension
2. **Architecture**: [docs/arch.md](docs/arch.md) — Positioning, pipeline, IR, plugins, layout, editor
3. **Reference**: [docs/reference.md](docs/reference.md) — Build config, monorepo, layout settings, test fixtures, fidelity per exporter
4. **Roadmap**: [docs/roadmap.md](docs/roadmap.md) — Open work only
5. **Examples**: [docs/examples/](docs/examples/) — Demo files (Mermaid, PlantUML, Marp, circuits); also the layout-metrics corpus

---

## Golden Comments (Key Invariants)

- **G1: IR contract is law** — All transformations read from IR, never raw AST. Parser → IR → Engine → Renderers/Exporters. Non-negotiable.
- **G2: Plugin lifecycle fixed** — Types → Parser → Engine → Renderers → Exporters. Cannot add stages or reorder. Plugins must follow contract.
- **G3: Import fallback behavior** — null fence wraps in default (non-negotiable for backward compat). All unsupported constructs degrade gracefully.
- **G4: Fidelity documented** — Mermaid export is lossy (9-sample corpus tests). PlantUML better. Document per-renderer limitations clearly.

---

## Scripts & Automation

Available in `/scripts/`:
- `build.sh` — Turbo builds all packages (core, CLI, LSP, VS Code ext, web)
- `test.sh` — Vitest suite (watch/once modes)
- `debug.sh`, `package-vsix.sh`, `install-vscode.sh`, `bump-versions.sh`, `deploy.sh` — see scripts/README.md
- `layout-metrics.mjs` — layout-quality report over docs/examples (gated by a Vitest baseline)

**Bash aliases** (add to session):
```bash
alias build='npm run build'
alias dev='npm run dev'
alias test='npm run test'
alias metrics='node scripts/layout-metrics.mjs --quiet'
```

---

## Workspace Layout

Monorepo (npm workspaces + Turborepo): `packages/core/`, `packages/cli/`, `packages/interaction/`, `packages/vscode-ext/`, `packages/web/`, `docs/`.

## Key Architecture Points

## PAiRS Skill Shortcuts

Use [/pairs skill](/.claude/skills/pairs) for code navigation.

**Common queries for SelDiA:**
```bash
# Trace IR contract compliance (G1 rule)
/pairs find_symbol "IntermediateRepresentation|IRNode" --preview

# Find all renderers (Mermaid, PlantUML, etc.)
/pairs find_symbol ".*Renderer" --regex

# Check parser lifecycle coverage
/pairs grep_symbols "parser|engine|renderer|exporter" --regex --preview

# Verify fidelity documentation per-renderer
/pairs find_symbol "Fidelity|Lossy" --regex

# Trace import fallback behavior
/pairs find_symbol "import.*fallback|null.*fence" --regex
```

**Key concepts:

- **IR contract**: All transformations read from IR, never raw AST — see [docs/arch.md](docs/arch.md)
- **Plugin lifecycle**: Types → Parser → Engine → Renderers → Exporters
- **Import fallback**: null fence wraps in default (non-negotiable for backward compat)
- **Fidelity**: Mermaid export is lossy (9-sample corpus tests); PlantUML better
- **Floorplan**: offsetTop for layout scaling (not getBoundingClientRect)

---

**ADR Reference:** View architectural decisions:
```bash
git log --grep="ADR" --oneline
```

---

## Maintenance

**When adding/removing config files or monorepo packages:**
1. Update [docs/reference.md](docs/reference.md) (Build and config table) — add/remove the file or package row
2. Document purpose and how to modify

**When adding/removing test fixtures, corpora or exporter fidelity tests:**
1. Update [docs/reference.md](docs/reference.md) (Test fixtures and gates table) — add/remove the fixture row
2. Update the fidelity section with what survives the import/export round trip
3. Layout baseline changes: regenerate `layout-baseline.json` as described there and review the diff

**When finishing a roadmap item:** delete it from [docs/roadmap.md](docs/roadmap.md) (it holds open work only).

**Last updated:** 2026-09-15 (Token-optimized with memory enforcement)
