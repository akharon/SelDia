#!/usr/bin/env bash
# =============================================================================
# SelDiA — Install VS Code Extension Locally
# Usage: ./scripts/install-vscode.sh [--repackage] [--dev]
#
# Packages and installs the SelDiA VS Code extension directly from source.
# This bypasses the Marketplace — useful for testing local changes.
#
# Options:
#   --repackage    Force re-package even if the .vsix already exists
#   --dev          Skip version bump, use current dev version
#   --help         Show this help
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

REPACKAGE=false
DEV_MODE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repackage|-r)  REPACKAGE=true; shift ;;
    --dev|-d)        DEV_MODE=true; shift ;;
    --help|-h)       echo "Usage: ./scripts/install-vscode.sh [--repackage] [--dev]"; exit 0 ;;
    *)               echo "Unknown option: $1"; exit 1 ;;
  esac
done

VSCE_EXT_DIR="packages/vscode-ext"
VSIX_FILE="$ROOT_DIR/seldia-vscode-ext.vsix"

echo "🧩 SelDiA — VS Code Extension Installer"
echo "========================================="
echo ""

# ── Step 1: Build the extension ──────────────────────────────────────────────
echo "📦 Step 1: Building extension..."
if [ "$DEV_MODE" = true ]; then
  npx turbo run build --filter=seldia-vscode 2>&1 | tail -3
else
  npm run build 2>&1 | tail -3
fi
echo "   ✅ Build complete"
echo ""

# ── Step 2: Check for vsce ───────────────────────────────────────────────────
echo "🔧 Step 2: Checking tooling..."
if ! command -v npx &>/dev/null; then
  echo "   ❌ npx not found. Please install Node.js >= 22."
  exit 1
fi
echo "   ✅ npx available"
echo ""

# ── Step 3: Package .vsix ────────────────────────────────────────────────────
echo "📦 Step 3: Packaging extension..."
cd "$ROOT_DIR/$VSCE_EXT_DIR"

if [ -f "$VSIX_FILE" ] && [ "$REPACKAGE" = false ]; then
  echo "   ⏩ .vsix already exists at $VSIX_FILE (use --repackage to rebuild)"
else
  # Remove old .vsix if repackaging
  rm -f "$VSIX_FILE"
  
  # vsce packaging (output goes to parent dir)
  # --no-dependencies: prevents following npm workspace symlinks into parent dirs
  npx -y @vscode/vsce package --allow-missing-repository --no-dependencies --out "$VSIX_FILE" 2>&1
  echo "   ✅ Packaged: $VSIX_FILE"
fi
cd "$ROOT_DIR"
echo ""

# ── Step 4: Install via code CLI ─────────────────────────────────────────────
echo "🚀 Step 4: Installing extension..."
if ! command -v code &>/dev/null; then
  echo "   ⚠️  'code' command not found in PATH."
  echo "   🔧 Try adding it manually:"
  echo "      VS Code → Cmd/Ctrl+Shift+P → 'Install code command in PATH'"
  echo ""
  echo "   📁 The .vsix file is at: $VSIX_FILE"
  echo "   📁 Install manually: code --install-extension \"$VSIX_FILE\""
  exit 1
fi

code --install-extension "$VSIX_FILE" 2>&1
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────
echo "✅ SelDiA VS Code extension installed successfully!"
echo "   📁 File: $VSIX_FILE"
echo "   🔄 Reload VS Code to activate the extension."
echo ""
echo "💡 Quick checks:"
echo "   • Create a .sld file → syntax highlighting should activate"
echo "   • Run 'SelDiA: Deploy Copilot Skill' from command palette"
echo "   • Open a .md file with \`\`\`seldia blocks → inline rendering"
