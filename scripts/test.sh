#!/usr/bin/env bash
# =============================================================================
# SelDiA — Test Script
# Usage: ./scripts/test.sh [--watch] [--coverage] [--scope <package>] [-- <vitest-options>]
#
# Runs tests across the entire monorepo or a specific scope.
# Supports watch mode, coverage reports, and direct vitest passthrough.
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

WATCH=false
COVERAGE=false
SCOPE=""
VITEST_ARGS=()

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch|-w)      WATCH=true; shift ;;
    --coverage|-c)   COVERAGE=true; shift ;;
    --scope|-s)      SCOPE="$2"; shift 2 ;;
    --help|-h)       echo "Usage: ./scripts/test.sh [--watch] [--coverage] [--scope <pkg>] [-- <vitest-opts>]"; exit 0 ;;
    --)              shift; VITEST_ARGS=("$@"); break ;;
    *)               VITEST_ARGS+=("$1"); shift ;;
  esac
done

echo "🧪 SelDiA Test Suite"
echo "====================="

# Build first if not in watch mode
if [ "$WATCH" = false ]; then
  echo "📦 Building packages for test..."
  if [ -n "$SCOPE" ]; then
    npx turbo run build --filter="$SCOPE"
  else
    npx turbo run build
  fi
  echo "   ✅ Build complete"
fi

# Run tests
echo ""
echo "🏃 Running tests..."

VITEST_CMD="npx vitest run"
REPORT_DIR="$ROOT_DIR/test-reports"

if [ "$WATCH" = true ]; then
  VITEST_CMD="npx vitest"
fi

if [ "$COVERAGE" = true ]; then
  VITEST_CMD="$VITEST_CMD --coverage"
  mkdir -p "$REPORT_DIR/coverage"
fi

if [ -n "$SCOPE" ]; then
  # Run tests for a specific package
  echo "   Scope: $SCOPE"
  cd "$ROOT_DIR/packages/${SCOPE#@seldia/}" 2>/dev/null || cd "$ROOT_DIR"
  $VITEST_CMD "${VITEST_ARGS[@]}" || true
else
  # Run all tests
  echo "   All packages"
  $VITEST_CMD "${VITEST_ARGS[@]}" || true
fi

TEST_EXIT=$?

echo ""
echo "═══════════════════════════════════════════"
if [ $TEST_EXIT -eq 0 ]; then
  echo "  ✅ All tests passed!"
else
  echo "  ❌ Some tests failed (exit code: $TEST_EXIT)"
fi
echo "═══════════════════════════════════════════"

if [ "$COVERAGE" = true ]; then
  echo ""
  echo "📊 Coverage report:"
  echo "   HTML: $REPORT_DIR/coverage/index.html"
  echo "   LCOV: $REPORT_DIR/coverage/lcov.info"
fi

exit $TEST_EXIT
