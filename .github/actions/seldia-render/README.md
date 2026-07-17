# seldia-render (GitHub Action)

Renders `.sld` diagram files and ` ```seldia ` fenced Markdown blocks in a
repo to SVG using the SelDiA engine, and optionally commits the results back.

This exists because SelDiA cannot beat GitHub's native Mermaid rendering
inside a `.md` file preview — so instead of competing for that surface, this
Action routes around it: diagrams render in CI to committed SVG, which then
renders natively anywhere (GitHub file view, a wiki, a static site) without
needing any SelDiA-aware viewer at all.

## What it does

1. Installs `@seldia/cli`.
2. Runs `seldia render <path> -o <output> --theme <theme>`, which:
   - Walks the repo (skipping `node_modules`, `.git`, `dist`, `build`) for
     standalone `.sld` files and ` ```seldia ` / ` ```seldia-<type> ` fenced
     blocks inside `.md` files.
   - Compiles each one through the same engine pipeline the CLI's `compile`
     command uses (`engine.compile()` — parse → analyze → transform → layout
     → render).
   - Writes one SVG per diagram into the output directory, named after the
     source file's path (fenced blocks get a numeric suffix when a file has
     more than one).
3. If `commit: true` (the default), stages the output directory and commits/
   pushes if anything changed.

This is the same `seldia render` command available locally — the Action is a
thin wrapper, not a separate implementation, so local runs and CI runs can
never drift.

## Inputs

| Input | Default | Description |
|---|---|---|
| `path` | `.` | Directory to scan |
| `output` | `diagrams` | Output directory for rendered SVGs |
| `theme` | `sketchy-light` | SelDiA theme |
| `extra-extensions` | *(empty)* | Space-separated extra standalone-file extensions (e.g. `.seldia`) |
| `commit` | `true` | Whether to commit rendered SVGs back |
| `commit-message` | `chore: render SelDiA diagrams to SVG [skip ci]` | Commit message |

## Outputs

| Output | Description |
|---|---|
| `rendered-count` | Number of diagrams successfully rendered |
| `committed` | `"true"`/`"false"` — whether a commit was pushed |

## Usage

See [`.github/workflows/render-diagrams.yml.example`](../../workflows/render-diagrams.yml.example)
for a complete workflow. Minimal form:

```yaml
permissions:
  contents: write

jobs:
  render:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: seldia/seldia/.github/actions/seldia-render@main
```

## What's tested vs. not

The core logic — finding `.sld` files and ` ```seldia ` fenced blocks, and
compiling each to SVG — is unit- and CLI-level tested in
[`packages/cli/test/scan.test.ts`](../../../packages/cli/test/scan.test.ts)
and [`packages/cli/test/render.test.ts`](../../../packages/cli/test/render.test.ts).

**Not tested in this environment** (no GitHub-hosted runner available here):
the `action.yml` composite steps themselves (checkout, `npm install`, the
`git add`/`commit`/`push` sequence) and real GitHub Actions execution.
Validate those manually by copying the example workflow into a test repo
before relying on this for a real team's CI.
