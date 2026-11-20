# SelDiA Codebase Guide

## Session preferences

- Keep chat responses silent/minimal to save tokens — avoid narration, progress updates, or verbose explanations unless asked.
- Batch independent Read/Edit/Bash calls together to reduce round-trips.
- Trust diffs on edits — never ask to verify changes after Edit tool succeeds.
- Ask for specific line ranges when reading large files, not whole files.
- Reference code by `file:line` markdown links instead of quoting content.
- **Keep test/diagnostic output token-optimized** — run tests/scripts in quiet or summary mode, avoid verbose/debug logging flags, and don't dump full logs into chat; report pass/fail counts and only the relevant failure excerpt.
- **Save project context to memory** → the project memory directory under `~/.claude/projects/` (resolved per-OS by Claude Code) (e.g., architectural decisions, common patterns, token optimizations learned).

---

## Quick Summary

**SelDiA** (Self-Diagramming Architecture) is a unified diagram engine: Mermaid/PlantUML/SelDiA DSL → intermediate representation → 31+ diagram types (flowchart, sequence, class, C4, BPMN, etc.) with LSP, validation, and round-trip export. Thesis: drift is the unsolved problem—keeping diagrams true as systems evolve requires an IR, not just generation.

---

## Reading Order

1. **Configuration**: [docs/CONFIG.md](docs/CONFIG.md) — Build config, monorepo setup, linting/formatting
2. **Data & Fixtures**: [docs/DATA.md](docs/DATA.md) — Test fixtures, golden values, fidelity per-renderer
3. **Architecture**: [docs/arch.md](docs/arch.md) — Design, IR concepts, plugin system
4. **User guide**: [docs/user_guide.md](docs/user_guide.md) — How to use DSL and CLI
5. **Examples**: [docs/examples/](docs/examples/) — Demo files (Mermaid, PlantUML, Marp)
6. **Roadmap**: [docs/roadmap.md](docs/roadmap.md) — Next steps and open work
7. **Market context**: [docs/market.md](docs/market.md) — Competitive analysis

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
- `dev.sh` — Watch mode for active development
- `lint.sh` — ESLint + Prettier
- `validate-examples.sh` — Compile all demo files; ensure examples stay valid

**Bash aliases** (add to session):
```bash
alias build='npm run build'
alias dev='npm run dev'
alias test='npm run test'
alias lint='./scripts/lint.sh'
alias validate='./scripts/validate-examples.sh'
```

---

## Workspace Layout

Monorepo (npm workspaces + turbo): `packages/core/`, `packages/cli/`, `packages/interaction/`, `packages/vscode-ext/`, `packages/web/`, `docs/`.

## Key Architecture Points

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
1. Update [docs/CONFIG.md](docs/CONFIG.md) — add/remove file/package row
2. Document purpose and how to modify

**When adding/removing test fixtures or renderer fidelity tests:**
1. Update [docs/DATA.md](docs/DATA.md) — add/remove fixture row
2. Update renderer fidelity section with loss rate and supported features
3. Document how to add new golden values for visual regression tests

**Example:** If you add a new `packages/json-renderer/`:
```markdown
| File | Purpose | Format | Usage |
|------|---------|--------|-------|
| `packages/json-renderer/tests/golden_*.json` | Expected JSON output | JSON | Visual regression tests |
```

And fidelity:
```markdown
- **JSON Renderer**: Lossless (exports IR directly to JSON)
  - Supported: All IR node types
  - Loss rate: 0% (complete fidelity)
```

**Last updated:** 2026-09-15 (Token-optimized with memory enforcement)
