#!/usr/bin/env bash
# =============================================================================
# SelDiA — VSIX Package Script
# Usage: ./scripts/package-vsix.sh [--out <dir>] [--no-build]
#
# Builds the SelDiA VS Code extension and packages it into a .vsix file.
#
# Options:
#   --out <dir>      Output directory for the .vsix file (default: packages/vscode-ext)
#   --no-build       Skip the build step (use if already built)
#   --help, -h       Show this help message
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

OUT_DIR=""
SKIP_BUILD=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)          OUT_DIR="$2"; shift 2 ;;
    --no-build)     SKIP_BUILD=true; shift ;;
    --help|-h)      echo "Usage: ./scripts/package-vsix.sh [--out <dir>] [--no-build]"; exit 0 ;;
    *)              echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${GREEN}📦 SelDiA VSIX Packager${NC}"
echo "======================"
echo ""

# ── Check prerequisites ──────────────────────────────────────
# Resolve vsce via npx so it works regardless of which nvm/node version is
# active. @vscode/vsce is a devDependency of packages/vscode-ext, so this hits
# node_modules/.bin and needs no global install and no network.
VSCE=(npx --no-install vsce)
if ! "${VSCE[@]}" --version &>/dev/null; then
  if command -v vsce &>/dev/null; then
    VSCE=(vsce)
  else
    echo -e "${RED}✗ 'vsce' not found. Run 'npm install' at the repo root${NC}"
    echo -e "${RED}  (or install globally: npm install -g @vscode/vsce)${NC}"
    exit 1
  fi
fi
echo -e "${GREEN}✓ vsce found: ${VSCE[*]}${NC}"

VSCE_VERSION=$("${VSCE[@]}" --version 2>/dev/null || echo "?")
echo "  Version: $VSCE_VERSION"
echo ""

# ── Build step ────────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  echo -e "${YELLOW}🔨 Building all packages...${NC}"
  if ! npx turbo run build --force 2>&1; then
    echo ""
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓ Build complete${NC}"
  echo ""
else
  echo -e "${YELLOW}⏭️  Skipping build step (--no-build)${NC}"
  echo ""
fi

# ── Ensure icon exists ────────────────────────────────────────
ICON_PATH="$ROOT_DIR/packages/vscode-ext/media/icon.png"
if [ ! -f "$ICON_PATH" ]; then
  # Try copying from assets as fallback
  ASSETS_ICON="$ROOT_DIR/assets/icon.png"
  if [ -f "$ASSETS_ICON" ]; then
    echo -e "${YELLOW}⚠️  icon.png not found in media/, copying from assets/${NC}"
    cp "$ASSETS_ICON" "$ICON_PATH"
    echo -e "${GREEN}✓ Copied icon.png${NC}"
  else
    echo -e "${YELLOW}⚠️  No icon.png found — VSIX will use default icon${NC}"
  fi
  echo ""
fi

# ── Package VSIX ──────────────────────────────────────────────
EXT_DIR="$ROOT_DIR/packages/vscode-ext"
cd "$EXT_DIR"

echo -e "${YELLOW}📦 Packaging VSIX...${NC}"
echo "  Source: $EXT_DIR"

if [ -n "$OUT_DIR" ]; then
  mkdir -p "$OUT_DIR"
  "${VSCE[@]}" package --allow-missing-repository --no-dependencies --out "$OUT_DIR"
  echo ""
  echo -e "${GREEN}✅ VSIX package created in:${NC}"
  echo "   $(ls -1 "$OUT_DIR"/*.vsix 2>/dev/null || echo '(none)')"
else
  # Output to root dir to avoid including parent workspace files
  VSIX_OUT="$ROOT_DIR/seldia-vscode-ext.vsix"
  "${VSCE[@]}" package --allow-missing-repository --no-dependencies --out "$VSIX_OUT"
  echo ""
  echo -e "${GREEN}✅ VSIX package created:${NC}"
  echo "   $VSIX_OUT"
fi

cd "$ROOT_DIR"

echo ""
echo -e "${GREEN}🎉 Done!${NC}"
echo ""
echo "   To install in VS Code:"
echo "     code --install-extension $([ -n "$OUT_DIR" ] && echo "$OUT_DIR/*.vsix" || echo "seldia-vscode-ext.vsix")"
echo ""
echo "   Or via the Extensions panel:"
echo "     ⋮ → Install from VSIX..."
