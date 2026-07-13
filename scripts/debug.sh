#!/usr/bin/env bash
# =============================================================================
# SelDiA — Debug Script
# Usage: ./scripts/debug.sh [--scope <package>] [--verbose] [--break]
#
# Builds with source maps, enables debug logging, and runs in development mode.
# Options:
#   --scope <pkg>  Debug a specific package only
#   --verbose      Enable verbose debug output (TRACE level)
#   --break        Add inspector breakpoint (node --inspect-brk)
#   --diagram      Path to a .seldia file to compile and inspect debug output
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

SCOPE=""
VERBOSE=false
BREAK=false
DIAGRAM=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope|-s)     SCOPE="$2"; shift 2 ;;
    --verbose|-v)   VERBOSE=true; shift ;;
    --break|-b)     BREAK=true; shift ;;
    --diagram|-d)   DIAGRAM="$2"; shift 2 ;;
    --help|-h)      echo "Usage: ./scripts/debug.sh [--scope <pkg>] [--verbose] [--break] [--diagram <file.seldia>]"; exit 0 ;;
    *)              echo "Unknown: $1"; exit 1 ;;
  esac
done

echo "🐛 SelDiA Debug Mode"
echo "===================="

# Build with source maps
echo "📦 Building with source maps..."
export NODE_ENV=development

if [ -n "$SCOPE" ]; then
  npx turbo run build --filter="$SCOPE"
else
  npx turbo run build
fi

echo "   ✅ Build done (source maps enabled)"

# If a diagram file is provided, compile it with debug output
if [ -n "$DIAGRAM" ]; then
  if [ ! -f "$DIAGRAM" ]; then
    echo "❌ File not found: $DIAGRAM"
    exit 1
  fi
  echo ""
  echo "📐 Compiling diagram: $DIAGRAM"
  echo "   Debug output:"
  echo "   ─────────────────────────────────────────────"

  DEBUG_OPTS=""
  if [ "$VERBOSE" = true ]; then
    DEBUG_OPTS="$DEBUG_OPTS --debug"
  fi

  NODE_OPTS=""
  if [ "$BREAK" = true ]; then
    NODE_OPTS="--inspect-brk"
    echo "   🔴 Inspector listening on port 9229 (attach Chrome DevTools)"
  fi

  node $NODE_OPTS packages/cli/dist/index.js compile "$DIAGRAM" --debug $DEBUG_OPTS
  echo ""
  echo "   ─────────────────────────────────────────────"
fi

# Start dev watchers
echo ""
echo "👀 Starting watch mode..."
echo "   Changes will auto-rebuild. Press Ctrl+C to stop."
echo ""

if [ -n "$SCOPE" ]; then
  npx turbo run dev --filter="$SCOPE"
else
  npx turbo run dev
fi
