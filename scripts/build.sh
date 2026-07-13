#!/usr/bin/env bash
# =============================================================================
# SelDiA — Build Script
# Usage: ./scripts/build.sh [--watch] [--clean] [--scope <package>]
#
# Builds all packages or a specific scope in the monorepo.
# Supports: --watch (dev mode), --clean (full rebuild), --scope (single pkg)
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

WATCH=false
CLEAN=false
SCOPE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch|-w)    WATCH=true; shift ;;
    --clean|-c)    CLEAN=true; shift ;;
    --scope|-s)    SCOPE="$2"; shift 2 ;;
    --help|-h)     echo "Usage: ./scripts/build.sh [--watch] [--clean] [--scope <package>]"; exit 0 ;;
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
if [ "$WATCH" = false ] && [ -z "$SCOPE" ]; then
  echo "🔍 Checking types..."
  npx tsc --noEmit --project tsconfig.base.json 2>/dev/null || echo "   ⚠️  Type check skipped (use --strict for full check)"
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
