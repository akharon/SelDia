#!/usr/bin/env bash
# =============================================================================
# SelDiA — Build Script
# Usage: ./scripts/build.sh [--watch] [--clean] [--scope <package>] [--strict]
#
# Builds all packages or a specific scope in the monorepo.
# Supports: --watch (dev mode), --clean (full rebuild), --scope (single pkg),
#           --strict (type errors fail the build instead of only warning)
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

WATCH=false
CLEAN=false
SCOPE=""
STRICT=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch|-w)    WATCH=true; shift ;;
    --clean|-c)    CLEAN=true; shift ;;
    --scope|-s)    SCOPE="$2"; shift 2 ;;
    --strict)      STRICT=true; shift ;;
    --help|-h)     echo "Usage: ./scripts/build.sh [--watch] [--clean] [--scope <package>] [--strict]"; exit 0 ;;
    *)             echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Clean step
if [ "$CLEAN" = true ]; then
  echo "🧹 Cleaning build artifacts..."
  if [ -n "$SCOPE" ]; then
    npx turbo run clean --filter="$SCOPE"
  else
    npx turbo run clean
  fi
  rm -rf node_modules/.cache/turbo
  echo "✅ Clean complete"
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Build step
echo "🔨 Building..."
if [ "$WATCH" = true ]; then
  if [ -n "$SCOPE" ]; then
    echo "   Watch mode, scope: $SCOPE"
    npx turbo run dev --filter="$SCOPE"
  else
    echo "   Watch mode, all packages"
    npx turbo run dev
  fi
else
  if [ -n "$SCOPE" ]; then
    echo "   Production build, scope: $SCOPE"
    npx turbo run build --filter="$SCOPE"
  else
    echo "   Production build, all packages"
    npx turbo run build
  fi
fi

# Type check (only in full production build)
# NOTE: check each package's own tsconfig.json. tsconfig.base.json is a base for
# `extends` only — it has no `include`, so pointing tsc at it globs the whole repo
# against a rootDir (./src) that does not exist at the root, yielding only TS6059.
if [ "$WATCH" = false ] && [ -z "$SCOPE" ]; then
  echo "🔍 Checking types..."
  TYPE_ERRORS=0
  for cfg in packages/*/tsconfig.json; do
    pkg_dir="$(dirname "$cfg")"
    if npx tsc --noEmit --project "$cfg"; then
      echo "   ✓ $(basename "$pkg_dir")"
    else
      echo "   ✗ $(basename "$pkg_dir") — type errors above"
      TYPE_ERRORS=$((TYPE_ERRORS + 1))
    fi
  done

  if [ "$TYPE_ERRORS" -gt 0 ]; then
    if [ "$STRICT" = true ]; then
      echo ""
      echo "❌ Type check failed in $TYPE_ERRORS package(s)."
      exit 1
    fi
    echo "   ⚠️  Type errors in $TYPE_ERRORS package(s) (use --strict to fail the build)"
  fi
fi

echo ""
echo "✅ Build complete!"
echo "   Output: packages/*/dist/"
echo ""
echo "📦 Packages built:"
for pkg in packages/*/package.json; do
  name=$(grep '"name"' "$pkg" | head -1 | sed 's/.*: "\(.*\)",/\1/')
  echo "   • $name"
done
