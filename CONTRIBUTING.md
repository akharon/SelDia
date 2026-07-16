# Contributing to SelDiA

Thank you for your interest in contributing to SelDiA! This document provides guidelines for contributing to the project.

## Getting Started

### Prerequisites

- **Node.js** >= 22.0.0
- **npm** >= 10.9.0
- Git

### Development Setup

```bash
# Clone the repository
git clone https://github.com/username/seldia.git
cd seldia

# Install dependencies (workspaces)
npm install

# Build all packages
npm run build

# Run tests
npm run test

# Start development mode
npm run dev
```

## Project Structure

SelDiA is a monorepo with the following packages:

```
packages/
  ├── core/            # Parser, compiler, IR, engine, plugins
  ├── cli/             # Command-line interface
  ├── web/             # Web components (<seldia-viewer>)
  ├── interaction/     # UI interactions (zoom, pan, selection)
  └── vscode-ext/      # VS Code extension
```

### Core Package (`@seldia/core`)

The heart of SelDiA. Contains:
- DSL parser and compiler
- Intermediate representation (IR)
- Rendering engine
- Layout engines (Dagre)
- Diagram type plugins (flowchart, class, sequence, etc.)

**Key files:**
- `src/parser.ts` — DSL parsing
- `src/engine.ts` — Compilation and SVG rendering
- `src/diagrams/` — Diagram type plugins
- `src/layout/` — Layout algorithms

### CLI Package (`@seldia/cli`)

Command-line tools for SelDiA:
- `compile` — Compile DSL to SVG
- `validate` — Check DSL syntax
- `serve` — Local dev server
- `init` — Create new diagram

## Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
git checkout -b fix/issue-number
```

Branch naming convention:
- `feature/` — New features
- `fix/` — Bug fixes
- `docs/` — Documentation
- `refactor/` — Code refactoring
- `test/` — Test improvements
- `chore/` — Build/tooling changes

### 2. Make Your Changes

- Write clear, descriptive commit messages
- Keep commits logically separated
- Test your changes before committing

### 3. Run Tests and Lint

```bash
# Run all tests
npm run test

# Run tests for a specific package
npm run test -- --filter=@seldia/core

# Lint
npm run lint

# Format (if prettier is set up)
npx prettier --write .
```

### 4. Write Tests

Add tests for new features or bug fixes:

- Unit tests: `src/**/*.test.ts`
- Integration tests: `tests/integration.mjs`
- Test files follow the pattern `*.test.ts` or `*.spec.ts`

Example test file location:
```
packages/core/src/diagrams/flowchart.test.ts
```

### 5. Create a Pull Request

- Push your branch: `git push origin feature/your-feature-name`
- Open a PR on GitHub with a clear title and description
- Reference related issues: "Fixes #123"
- Wait for CI checks and review

## Commit Message Guidelines

Follow conventional commits format:

```
type(scope): subject line (< 50 chars)

Longer explanation here (< 72 chars per line).
Explain what, why, and how.

- Use bullet points for multiple changes
- Keep it concise and clear

Fixes #123
Co-Authored-By: Name <email>
```

Types:
- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation
- `test` — Tests
- `refactor` — Code refactoring (no behavior change)
- `perf` — Performance improvement
- `chore` — Build, tooling, dependencies

Examples:
```
feat(flowchart): add support for diamond shape

fix(parser): handle multiline labels correctly

docs(arch): explain plugin system

test(class): add edge arrowhead tests

chore: bump version 1.11.0 → 1.12.0
```

## Code Style

### TypeScript

- Use TypeScript strict mode
- Prefer `const` over `let` over `var`
- Use descriptive variable names
- Add types explicitly (no implicit `any`)
- Write comments only for non-obvious logic

### Naming Conventions

- **Files**: `kebab-case` (e.g., `flowchart.ts`, `dsl-parser.ts`)
- **Classes**: `PascalCase` (e.g., `DiagramEngine`, `FlowchartPlugin`)
- **Functions/Variables**: `camelCase` (e.g., `parseNode`, `nodeId`)
- **Constants**: `UPPER_SNAKE_CASE` for module-level constants
- **Interfaces/Types**: `PascalCase` (e.g., `IRNode`, `DiagramConfig`)

### File Organization

```typescript
// 1. Imports
import type { TypeA } from './types.js';
import { functionB } from './utils.js';

// 2. Types/Interfaces
export interface MyInterface {
  prop: string;
}

// 3. Constants
const DEFAULT_SIZE = 100;

// 4. Main logic/exports
export function myFunction() {
  // ...
}

// 5. Helper functions (if needed)
function helper() {
  // ...
}
```

## Adding a New Diagram Type

To add support for a new diagram type:

1. Create `packages/core/src/diagrams/mytype.ts`
2. Implement the plugin interface:
   ```typescript
   export const mytypePlugin: DiagramPlugin = {
     type: DiagramType.MYTYPE,
     parse: (code: string) => {
       // Parse DSL specific to this type
     },
     transform: (ast: AST) => {
       // Transform to IR (nodes, edges)
     }
   };
   ```
3. Register in `packages/core/src/index.ts`
4. Add tests in `packages/core/src/diagrams/mytype.test.ts`
5. Update documentation in `docs/user_guide.md`

## Documentation

### Updating User Guide

If your change affects user-facing behavior, update `docs/user_guide.md`:

```markdown
## Your Diagram Type

DSL syntax:
\`\`\`
diagram mytype "Title" {
  // Syntax here
}
\`\`\`

Example:
\`\`\`
diagram mytype "Login" {
  start: (Begin)
  end: (End)
  start --> end
}
\`\`\`
```

### Updating Architecture Docs

For internal changes, update `docs/arch.md`:

```markdown
### Your Component

Explain how it works, where it fits in the pipeline, and any design decisions.

**Related code:**
- `packages/core/src/your-file.ts`
- `packages/core/src/diagrams/your-type.ts`
```

## Reporting Issues

Use GitHub Issues to report:
- **Bug reports** — Unexpected behavior with reproduction steps
- **Feature requests** — New diagram types, DSL features, UI improvements
- **Questions** — How to use SelDiA (or GitHub Discussions if available)

Issue template:
```
## Description
Brief description of the issue

## Reproduction (for bugs)
Steps to reproduce:
1. Create diagram with...
2. Observe...
3. Expected vs. actual

## Logs/Screenshots
Attach relevant error messages or screenshots

## Environment
- OS: (Windows/macOS/Linux)
- Node: (version)
- SelDiA: (version)
```

## Pull Request Process

1. Fork and create a feature branch
2. Make changes and write tests
3. Run `npm run test` and `npm run lint`
4. Update documentation if needed
5. Push and open a PR
6. Respond to code review feedback
7. Once approved, maintainers will merge

## Release Process

(For maintainers)

1. Update version in `package.json` (all workspaces)
2. Update `CHANGELOG.md` (if maintaining one)
3. Create a release commit: `chore: bump version X.Y.Z`
4. Tag: `git tag vX.Y.Z`
5. Push and create GitHub Release
6. Publish packages to npm

Example:
```bash
npm version patch  # or minor, major
npm publish
git push && git push --tags
```

## Need Help?

- **Documentation**: See `docs/` folder
- **Architecture**: Read `docs/arch.md`
- **Examples**: Check `demo.md`
- **Issues**: Search existing GitHub issues
- **Discussions**: Start a GitHub Discussion (when available)

## License

By contributing to SelDiA, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing!** 🎉
