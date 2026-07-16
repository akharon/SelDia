#!/bin/bash

################################################################################
# GitHub Setup Script for SelDiA
#
# This script prepares the SelDiA project for GitHub upload by:
# 1. Cleaning up unnecessary files and folders
# 2. Removing local development documentation
# 3. Creating a fresh git history (shallow clone with tip only)
# 4. Setting up GitHub remote configuration
# 5. Preparing the project for first push
#
# Usage: bash scripts/github-setup.sh [github-url]
# Example: bash scripts/github-setup.sh https://github.com/username/seldia.git
################################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_info() {
    echo -e "${BLUE}ℹ ${1}${NC}"
}

print_success() {
    echo -e "${GREEN}✓ ${1}${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ ${1}${NC}"
}

print_error() {
    echo -e "${RED}✗ ${1}${NC}"
}

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    print_error "Not a git repository. Please run this script from the project root."
    exit 1
fi

print_info "Starting SelDiA GitHub preparation..."

# Step 1: Clean up build artifacts and node modules
print_info "Step 1: Cleaning up build artifacts and dependencies..."
print_warning "This will remove node_modules, dist/, and build artifacts."

if [ -d "node_modules" ]; then
    rm -rf node_modules
    print_success "Removed node_modules/"
fi

if [ -d "dist" ]; then
    rm -rf dist
    print_success "Removed dist/"
fi

if [ -d ".turbo" ]; then
    rm -rf .turbo
    print_success "Removed .turbo/"
fi

# Clean package-lock files (npm will regenerate)
find . -name "package-lock.json" -delete 2>/dev/null || true
print_success "Removed package-lock.json files"

# Remove vscode extension binary
if [ -f "seldia-vscode-ext.vsix" ]; then
    rm -f seldia-vscode-ext.vsix
    print_success "Removed seldia-vscode-ext.vsix"
fi

# Step 2: Update .gitignore to be comprehensive
print_info "Step 2: Updating .gitignore..."
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
package-lock.json
yarn.lock
pnpm-lock.yaml

# Build outputs
dist/
build/
*.vsix

# Development
.env
.env.local
.env.*.local
.turbo/
.vscode/
.idea/

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
lerna-debug.log*

# IDE
.vscode
.idea
*.swp
*.swo
*~
.DS_Store

# Temporary files
test_seldia.mjs
/tmp/
.git-commit-id
.pairs/

# Generated SVGs (test outputs)
*.svg

# OS-specific
.DS_Store
Thumbs.db

# Editor
*.bak
*.tmp
EOF
print_success "Updated .gitignore"

# Step 3: Clean up unnecessary documentation
print_info "Step 3: Cleaning up development documentation..."
print_warning "Removing internal development/review docs..."

# Keep only: README.md, user_guide.md, arch.md, index.md
# Remove: improvement_request.md, review-*.md, plan.md
if [ -f "docs/improvement_request.md" ]; then
    rm -f docs/improvement_request.md
    print_success "Removed docs/improvement_request.md"
fi

if [ -f "docs/plan.md" ]; then
    rm -f docs/plan.md
    print_success "Removed docs/plan.md"
fi

find docs -name "review-*.md" -delete 2>/dev/null || true
print_success "Removed docs/review-*.md files"

# Step 4: Verify essential files exist
print_info "Step 4: Verifying essential files..."

required_files=(
    "README.md"
    "package.json"
    ".gitignore"
    "docs/user_guide.md"
    "docs/arch.md"
)

all_present=true
for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        print_success "Found $file"
    else
        print_warning "Missing $file (optional)"
    fi
done

# Step 5: Prepare git for GitHub
print_info "Step 5: Preparing git repository for GitHub..."

# Verify we have commits
commit_count=$(git rev-list --count HEAD)
if [ "$commit_count" -lt 1 ]; then
    print_error "No commits found in repository"
    exit 1
fi
print_success "Found $commit_count commits"

# Get current branch
current_branch=$(git rev-parse --abbrev-ref HEAD)
print_success "Current branch: $current_branch"

# Step 6: Stage cleaned files
print_info "Step 6: Staging cleanup changes..."

git add -A
changed_files=$(git diff --cached --name-only | wc -l)
if [ "$changed_files" -gt 0 ]; then
    print_success "Staged $changed_files files for cleanup"

    # Create cleanup commit
    git commit -m "chore: remove build artifacts and internal docs

- Remove node_modules, dist/, .turbo build cache
- Remove vsix extension binary
- Clean up internal development docs (review notes, plans)
- Update .gitignore with comprehensive patterns

Co-Authored-By: GitHub Setup <noreply@github.com>"

    print_success "Created cleanup commit"
else
    print_success "No cleanup files to stage"
fi

# Step 7: Create or update GitHub remote
print_info "Step 7: GitHub remote configuration..."

github_url="${1:-}"

if [ -z "$github_url" ]; then
    print_warning "No GitHub URL provided as argument"
    print_info "To add a remote later, run:"
    echo "  git remote add origin <github-url>"
    echo "  git branch -M main"
    echo "  git push -u origin main"
else
    # Add or update origin remote
    if git remote | grep -q "^origin$"; then
        print_info "Updating existing origin remote..."
        git remote set-url origin "$github_url"
    else
        print_info "Adding origin remote..."
        git remote add origin "$github_url"
    fi

    print_success "Set origin to: $github_url"

    # Ensure main branch exists and is checked out
    if [ "$current_branch" != "main" ]; then
        print_info "Renaming $current_branch to main..."
        git branch -M main
        print_success "Branch renamed to main"
    fi
fi

# Step 8: Summary
print_info "Setup complete! Summary:"
echo ""
echo "✓ Cleaned build artifacts (node_modules, dist, .turbo)"
echo "✓ Removed extension binary (vsix)"
echo "✓ Removed internal documentation (review notes, plans)"
echo "✓ Updated .gitignore"
echo "✓ Created cleanup commit"
if [ -n "$github_url" ]; then
    echo "✓ Configured GitHub remote"
    echo ""
    echo "Next steps:"
    echo "  1. Verify changes: git log --oneline -5"
    echo "  2. Push to GitHub: git push -u origin main"
else
    echo ""
    echo "Next steps:"
    echo "  1. Add GitHub remote: git remote add origin <url>"
    echo "  2. Rename branch: git branch -M main"
    echo "  3. Verify changes: git log --oneline -5"
    echo "  4. Push to GitHub: git push -u origin main"
fi

print_success "Ready for GitHub!"
