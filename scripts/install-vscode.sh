#!/usr/bin/env bash
# =============================================================================
# SelDiA — Install VS Code Extension Locally
# Usage: ./scripts/install-vscode.sh [--repackage] [--dev]
#
# Packages and installs the SelDiA VS Code extension directly from source.
# This bypasses the Marketplace — useful for testing local changes.
#
# The extension is always rebuilt and repackaged from source, so the installed
# VSIX always matches the current working tree.
#
# Options:
#   --repackage    Deprecated no-op (repackaging is now always done)
#   --dev          Build only the vscode-ext package (faster; skips siblings)
#   --help         Show this help
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

REPACKAGE=false
DEV_MODE=false
DEPLOY_SKILL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repackage|-r)  REPACKAGE=true; shift ;;  # deprecated: always repackaged now
    --dev|-d)        DEV_MODE=true; shift ;;
    --deploy-skill)  DEPLOY_SKILL=true; shift ;;
    --help|-h)       echo "Usage: ./scripts/install-vscode.sh [--repackage] [--dev] [--deploy-skill]"; exit 0 ;;
    *)               echo "Unknown option: $1"; exit 1 ;;
  esac
done

VSCE_EXT_DIR="packages/vscode-ext"
VSIX_FILE="$ROOT_DIR/seldia-vscode-ext.vsix"

echo "🧩 SelDiA — VS Code Extension Installer"
echo "========================================="
echo ""

# ── Step 1: Check commit and bump versions ──────────────────────────────────
echo "📦 Step 1: Checking commit and bumping versions if needed..."
bash "$ROOT_DIR/scripts/bump-versions.sh" || true
echo ""

# ── Step 2: Build the extension ──────────────────────────────────────────────
echo "📦 Step 2: Building extension..."
if [ "$DEV_MODE" = true ]; then
  npx turbo run build --filter=seldia-vscode 2>&1 | tail -3
else
  npm run build 2>&1 | tail -3
fi
echo "   ✅ Build complete"
echo ""

# ── Step 3: Check for vsce ───────────────────────────────────────────────────
echo "🔧 Step 3: Checking tooling..."
if ! command -v npx &>/dev/null; then
  echo "   ❌ npx not found. Please install Node.js >= 22."
  exit 1
fi
echo "   ✅ npx available"
echo ""

# ── Step 4: Package .vsix ────────────────────────────────────────────────────
# Always repackage. Step 2 just rebuilt dist/, so any pre-existing .vsix is by
# definition stale — reusing it would install yesterday's code (and icons) over
# today's fresh build. That is exactly the bug that made installs look like they
# "didn't work". Packaging is cheap; correctness beats the shortcut.
echo "📦 Step 4: Packaging extension..."
cd "$ROOT_DIR/$VSCE_EXT_DIR"

# Remove the stale .vsix so a packaging failure can't leave an old one behind
# for Step 4 to silently install.
rm -f "$VSIX_FILE"

# vsce packaging (output goes to parent dir)
# --no-dependencies: prevents following npm workspace symlinks into parent dirs
npx -y @vscode/vsce package --allow-missing-repository --no-dependencies --out "$VSIX_FILE" 2>&1
echo "   ✅ Packaged (fresh): $VSIX_FILE"
cd "$ROOT_DIR"
echo ""

# ── Step 5: Install via code CLI ─────────────────────────────────────────────
echo "🚀 Step 5: Installing extension..."
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

# ── Step 6: Deploy Copilot & Claude skills ──────────────────────────────────
deploy_skill() {
  local name="$1"         # Display name (e.g. "Copilot", "Claude Code")
  local target_dir="$2"   # Destination directory (parent of seldia-dsl/)
  local deployed_by="$3"  # Origin identifier for manifest
  local target="${target_dir}/seldia-dsl/SKILL.md"

  mkdir -p "$(dirname "$target")"
  cp "$SKILL_SRC" "$target"
  cat > "$(dirname "$target")/.sld-skill-manifest.json" <<- JSONEOF
{
  "name": "seldia-dsl",
  "version": "1.0.0",
  "deployedBy": "${deployed_by}",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "scope": "user",
  "skillPath": "${target}",
  "contentHash": "sha256:deployed"
}
JSONEOF
  echo "   ✅ ${name} skill deployed to: $(dirname "$target")"
}

if [ "$DEPLOY_SKILL" = true ]; then
  echo "🧠 Step 6: Deploying skills..."
  SKILL_SRC="$ROOT_DIR/packages/vscode-ext/resources/skills/seldia-dsl/SKILL.md"

  if [ -f "$SKILL_SRC" ]; then
    deploy_skill "Copilot" "${HOME}/.copilot/skills" "seldia-vscode-ext@1.0.0 (install-vscode.sh)"
    deploy_skill "Claude Code" "${HOME}/.claude/skills" "seldia-vscode-ext@1.0.0 (install-vscode.sh)"
  else
    echo "   ⚠️  Skill source not found at: ${SKILL_SRC}"
  fi
  echo ""
else
  echo "🧠 Step 6: Skipping skill deploy (use --deploy-skill to enable)"
  echo ""
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo "✅ SelDiA VS Code extension installed successfully!"
echo "   📁 File: $VSIX_FILE"
echo "   🔄 Reload VS Code to activate the extension."
echo ""
echo "💡 Quick checks:"
echo "   • Create a .sld file → syntax highlighting should activate"
if [ "$DEPLOY_SKILL" = true ]; then
  echo "   • Copilot skill deployed to: ~/.copilot/skills/seldia-dsl/"
  echo "   • Claude Code skill deployed to: ~/.claude/skills/seldia-dsl/"
fi
echo "   • Open a .md file with \`\`\`seldia blocks → inline rendering"
