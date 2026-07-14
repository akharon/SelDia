#!/usr/bin/env bash
# =============================================================================
# SelDiA — Bump Minor Versions on Commit Changes
# =============================================================================
# Checks if the git commit ID has changed since the last build.
# If changed, bumps the minor version in all package.json files.
#
# Usage: ./scripts/bump-versions.sh
#
# How it works:
#   1. Reads the last known commit ID from .git-commit-id (local state file)
#   2. Gets the current git HEAD commit ID
#   3. If different, bumps minor version in all packages and updates .git-commit-id
#   4. Returns exit code 0 if versions were bumped, 1 if unchanged
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

COMMIT_ID_FILE="$ROOT_DIR/.git-commit-id"
CURRENT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

# Read the last known commit ID
LAST_COMMIT=""
if [ -f "$COMMIT_ID_FILE" ]; then
  LAST_COMMIT=$(cat "$COMMIT_ID_FILE")
fi

# Check if commit has changed
if [ "$CURRENT_COMMIT" = "$LAST_COMMIT" ]; then
  echo "ℹ️  Commit unchanged ($CURRENT_COMMIT) — skipping version bump"
  exit 1
fi

echo "📝 Commit changed: $LAST_COMMIT → $CURRENT_COMMIT"
echo "🔄 Bumping minor versions in all packages..."
echo ""

# Find all package.json files in the packages/ directory (not node_modules)
PACKAGES=(
  "package.json"
  "packages/core/package.json"
  "packages/interaction/package.json"
  "packages/cli/package.json"
  "packages/web/package.json"
  "packages/vscode-ext/package.json"
)

for pkg_file in "${PACKAGES[@]}"; do
  if [ ! -f "$pkg_file" ]; then
    continue
  fi

  # Read current version
  current_version=$(grep -m 1 '"version"' "$pkg_file" | sed -E 's/.*"version"\s*:\s*"([^"]+)".*/\1/')

  # Parse version parts
  major=$(echo "$current_version" | cut -d. -f1)
  minor=$(echo "$current_version" | cut -d. -f2)
  patch=$(echo "$current_version" | cut -d. -f3)

  # Bump minor, reset patch
  new_minor=$((minor + 1))
  new_version="$major.$new_minor.0"

  # Update package.json (sed works on both macOS and Linux)
  sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$new_version\"/" "$pkg_file"
  rm -f "$pkg_file.bak"

  echo "   ✅ $pkg_file: $current_version → $new_version"
done

# Save the current commit ID
echo "$CURRENT_COMMIT" > "$COMMIT_ID_FILE"

echo ""
echo "✅ Version bump complete"
echo "   Commit ID saved: $CURRENT_COMMIT"
exit 0
