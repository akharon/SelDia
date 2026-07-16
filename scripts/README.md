# Scripts

Automation scripts for SelDiA project management.

## GitHub Preparation

### `github-setup.sh`
Prepares repository for GitHub upload.

```bash
bash scripts/github-setup.sh https://github.com/username/seldia.git
```

**Does:**
- Removes build artifacts (node_modules, dist, .turbo, .vsix)
- Removes internal documentation (improvement_request.md, plan.md, review-*.md — no-ops if already absent)
- Updates .gitignore
- Creates cleanup commit
- Configures GitHub remote
- Renames branch to main

### `verify-github-ready.sh`
Verifies repository is ready to push.

```bash
bash scripts/verify-github-ready.sh
```

**Checks:**
- No build artifacts in git
- .gitignore is comprehensive
- Essential docs exist
- No environment files tracked
- Remote is configured
- Working tree is clean

**Output:** Exit code 0 (ready) or 1 (issues)

## Icon Management

### `convert-icon.sh`
Generates PNG from SVG icon for VS Code extension.

```bash
bash scripts/convert-icon.sh
```

**Requires:** ImageMagick (`convert` command)

**Does:**
- Converts `packages/vscode-ext/media/icon.svg` to PNG
- Backs up existing PNG
- Verifies output

**Documentation:** [packages/vscode-ext/media/ICON-UPDATE.md](../packages/vscode-ext/media/ICON-UPDATE.md)

## Build & Test

### `build.sh`
Builds all packages using Turbo.

```bash
bash scripts/build.sh
```

### `test.sh`
Runs test suite across all packages.

```bash
bash scripts/test.sh
```

### `debug.sh`
Diagnostics and debugging utilities.

```bash
bash scripts/debug.sh
```

## Maintenance

### `bump-versions.sh`
Updates version numbers across packages.

```bash
bash scripts/bump-versions.sh [major|minor|patch]
```

### `deploy.sh`
Deployment automation (configure for your target).

```bash
bash scripts/deploy.sh
```

### `install-vscode.sh`
Installs VS Code extension locally.

```bash
bash scripts/install-vscode.sh
```
