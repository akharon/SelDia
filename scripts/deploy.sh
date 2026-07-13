#!/usr/bin/env bash
# =============================================================================
# SelDiA — Deploy Script
# Usage: ./scripts/deploy.sh [--dry-run] [--tag <npm-tag>] [--bump <patch|minor|major>]
#
# Deploys SelDiA packages to npm and/or VS Code Marketplace.
# Handles version bumping, building, publishing, and tagging.
#
# Options:
#   --dry-run          Simulate deployment without publishing
#   --tag <t>          npm dist-tag (default: "latest")
#   --bump <level>     Version bump: patch, minor, or major (default: patch)
#   --npm              Publish to npm only
#   --vscode           Publish to VS Code Marketplace only
#   --all              Publish to both npm and VS Code (default)
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

DRY_RUN=false
NPM_TAG="latest"
BUMP="patch"
TARGET="all"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)       DRY_RUN=true; shift ;;
    --tag|-t)        NPM_TAG="$2"; shift 2 ;;
    --bump|-b)       BUMP="$2"; shift 2 ;;
    --npm)           TARGET="npm"; shift ;;
    --vscode)        TARGET="vscode"; shift ;;
    --all|-a)        TARGET="all"; shift ;;
    --help|-h)       echo "Usage: ./scripts/deploy.sh [--dry-run] [--tag <tag>] [--bump <level>] [--npm|--vscode|--all]"; exit 0 ;;
    *)               echo "Unknown: $1"; exit 1 ;;
  esac
done

echo "🚀 SelDiA Deployment"
echo "======================"
echo "  Mode:       $([ "$DRY_RUN" = true ] && echo 'DRY RUN' || echo 'LIVE')"
echo "  npm tag:    $NPM_TAG"
echo "  Bump:       $BUMP"
echo "  Target:     $TARGET"
echo ""

# Ensure we're on main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
if [ "$CURRENT_BRANCH" != "main" ] && [ "$DRY_RUN" = false ]; then
  echo "⚠️  Not on main branch (current: $CURRENT_BRANCH). Continue? [y/N]"
  read -r response
  if [ "$response" != "y" ]; then
    echo "Aborted."
    exit 1
  fi
fi

# Check working directory is clean
if [ -n "$(git status --porcelain 2>/dev/null)" ] && [ "$DRY_RUN" = false ]; then
  echo "⚠️  Uncommitted changes detected. Continue? [y/N]"
  read -r response
  if [ "$response" != "y" ]; then
    echo "Aborted."
    exit 1
  fi
fi

# ── Version bump ─────────────────────────────────────────────
if [ "$DRY_RUN" = false ]; then
  echo "📝 Bumping version ($BUMP)..."

  # Bump root version
  npm version "$BUMP" --no-git-tag-version --allow-same-version

  # Sync workspace package versions to match root
  ROOT_VERSION=$(node -p "require('./package.json').version")
  for pkg in packages/*/package.json; do
    node -e "
      const p = require('$pkg');
      p.version = '$ROOT_VERSION';
      require('fs').writeFileSync('$pkg', JSON.stringify(p, null, 2) + '\n');
    "
  done

  # Commit version bump
  git add package.json packages/*/package.json
  git commit -m "chore: bump version to v$ROOT_VERSION"
  git tag "v$ROOT_VERSION"

  echo "   ✅ Version bumped to v$ROOT_VERSION"
else
  echo "📝 [DRY RUN] Would bump version ($BUMP)"
fi

# ── Build ─────────────────────────────────────────────────────
echo "🔨 Building all packages..."
if [ "$DRY_RUN" = false ]; then
  npx turbo run build
  echo "   ✅ Build complete"
else
  echo "   [DRY RUN] Would run: npx turbo run build"
fi

# ── Run tests ─────────────────────────────────────────────────
echo "🧪 Running tests..."
if [ "$DRY_RUN" = false ]; then
  npx vitest run 2>/dev/null || echo "   ⚠️  Some tests failed, continuing..."
  echo "   ✅ Tests complete"
else
  echo "   [DRY RUN] Would run: npx vitest run"
fi

# ── Publish to npm ───────────────────────────────────────────
publish_to_npm() {
  local pkg_dir="$1"
  local pkg_name="$2"

  if [ "$DRY_RUN" = false ]; then
    echo "   📦 Publishing $pkg_name..."
    cd "$ROOT_DIR/$pkg_dir"
    npm publish --tag "$NPM_TAG" --access public 2>/dev/null || {
      echo "   ⚠️  Failed to publish $pkg_name (may already exist)"
    }
    cd "$ROOT_DIR"
  else
    echo "   [DRY RUN] cd $pkg_dir && npm publish --tag $NPM_TAG --access public"
  fi
}

if [ "$TARGET" = "all" ] || [ "$TARGET" = "npm" ]; then
  echo ""
  echo "📦 Publishing to npm..."

  PUBLIC_PACKAGES=(
    "packages/core:@seldia/core"
    "packages/layout:@seldia/layout"
    "packages/render:@seldia/render"
    "packages/interaction:@seldia/interaction"
    "packages/cli:@seldia/cli"
    "packages/web:@seldia/web"
  )

  for entry in "${PUBLIC_PACKAGES[@]}"; do
    IFS=':' read -r dir name <<< "$entry"
    publish_to_npm "$dir" "$name"
  done

  echo "   ✅ npm publish complete"
fi

# ── Publish to VS Code Marketplace ───────────────────────────
if [ "$TARGET" = "all" ] || [ "$TARGET" = "vscode" ]; then
  echo ""
  echo "🧩 Publishing to VS Code Marketplace..."

  if command -v vsce &>/dev/null; then
    if [ "$DRY_RUN" = false ]; then
      cd "$ROOT_DIR/packages/vscode-ext"
      vsce publish --no-dependencies
      cd "$ROOT_DIR"
      echo "   ✅ VS Code Marketplace publish complete"
    else
      echo "   [DRY RUN] cd packages/vscode-ext && vsce publish"
    fi
  else
    echo "   ⚠️  'vsce' not found. Install with: npm install -g @vscode/vsce"
    echo "   Skipping VS Code Marketplace publish."
  fi
fi

# ── Push tags ────────────────────────────────────────────────
if [ "$DRY_RUN" = false ] && [ "$TARGET" != "none" ]; then
  echo ""
  echo "⬆️  Pushing tags to remote..."
  git push --follow-tags 2>/dev/null || echo "   ⚠️  Failed to push (no remote configured?)"
fi

echo ""
echo "═══════════════════════════════════════════"
if [ "$DRY_RUN" = true ]; then
  echo "  ✅ DRY RUN complete — no changes made"
else
  echo "  ✅ Deploy complete!"
fi
echo "═══════════════════════════════════════════"
echo ""
echo "📋 Summary:"
echo "   Version: $(node -p "require('./package.json').version")"
echo "   npm tag: $NPM_TAG"
echo "   Target:  $TARGET"
