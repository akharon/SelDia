#!/bin/bash

################################################################################
# GitHub Readiness Verification Script
#
# Checks that the repository is ready to push to GitHub:
# - No build artifacts or node_modules
# - .gitignore is comprehensive
# - Essential documentation exists
# - No accidental environment files
# - Remote is configured
#
# Usage: bash scripts/verify-github-ready.sh
################################################################################

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

check_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASS++))
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ((FAIL++))
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARN++))
}

echo -e "${BLUE}GitHub Readiness Check${NC}"
echo "================================="
echo ""

# Check 1: Git repo exists
if [ -d ".git" ]; then
    check_pass "Git repository found"
else
    check_fail "Not a git repository"
    exit 1
fi

# Check 2: No node_modules
if [ ! -d "node_modules" ]; then
    check_pass "node_modules not committed"
else
    if git ls-files | grep -q "^node_modules"; then
        check_fail "node_modules tracked in git (add to .gitignore)"
    else
        check_warn "node_modules exists locally (will be ignored)"
    fi
fi

# Check 3: No dist folder
if [ ! -d "dist" ]; then
    check_pass "dist/ not committed"
else
    if git ls-files | grep -q "^dist"; then
        check_fail "dist/ tracked in git (add to .gitignore)"
    else
        check_warn "dist/ exists locally (will be ignored)"
    fi
fi

# Check 4: No vsix files
vsix_files=$(find . -maxdepth 1 -name "*.vsix" -type f)
if [ -z "$vsix_files" ]; then
    check_pass "No .vsix files found"
else
    if git ls-files | grep -q "\.vsix$"; then
        check_fail ".vsix files tracked in git"
    else
        check_warn "Local .vsix files exist (will be ignored)"
    fi
fi

# Check 5: No .env files
env_files=$(git ls-files | grep -E "^\.env" || true)
if [ -z "$env_files" ]; then
    check_pass "No .env files tracked"
else
    check_fail "Environment files tracked in git: $env_files"
fi

# Check 6: .gitignore exists
if [ -f ".gitignore" ]; then
    check_pass ".gitignore exists"

    # Check for common patterns
    if grep -q "node_modules" .gitignore; then
        check_pass "  node_modules in .gitignore"
    else
        check_fail "  node_modules not in .gitignore"
    fi

    if grep -q "^dist" .gitignore; then
        check_pass "  dist/ in .gitignore"
    else
        check_fail "  dist/ not in .gitignore"
    fi

    if grep -q "\.vsix" .gitignore; then
        check_pass "  *.vsix in .gitignore"
    else
        check_fail "  *.vsix not in .gitignore"
    fi

    if grep -q "\.env" .gitignore; then
        check_pass "  .env in .gitignore"
    else
        check_fail "  .env not in .gitignore"
    fi
else
    check_fail ".gitignore not found"
fi

# Check 7: Essential docs exist
echo ""
echo "Documentation:"

docs_needed=("README.md" "docs/user_guide.md" "docs/arch.md")
for doc in "${docs_needed[@]}"; do
    if [ -f "$doc" ]; then
        check_pass "  $doc exists"
    else
        check_warn "  $doc missing (recommended)"
    fi
done

# Check 8: No internal docs
echo ""
echo "Internal docs cleanup:"

internal_docs=("docs/improvement_request.md" "docs/plan.md")
for doc in "${internal_docs[@]}"; do
    if [ ! -f "$doc" ]; then
        check_pass "  $doc removed"
    else
        check_warn "  $doc still present (consider removing)"
    fi
done

# Check for review files
review_files=$(find docs -name "review-*.md" -type f 2>/dev/null | wc -l)
if [ "$review_files" -eq 0 ]; then
    check_pass "  No review docs found"
else
    check_warn "  Found $review_files review docs (consider removing)"
fi

# Check 9: Remote configured
echo ""
echo "GitHub remote:"

if git remote | grep -q "^origin$"; then
    origin_url=$(git remote get-url origin)
    check_pass "origin remote configured: $origin_url"
else
    check_warn "origin remote not configured yet"
    check_warn "  Configure with: git remote add origin <url>"
fi

# Check 10: Main branch
current_branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$current_branch" = "main" ] || [ "$current_branch" = "master" ]; then
    check_pass "On branch: $current_branch"
else
    check_warn "On branch: $current_branch (consider renaming to 'main')"
fi

# Check 11: Commits exist
commit_count=$(git rev-list --count HEAD)
check_pass "Commits: $commit_count"

# Check 12: Nothing uncommitted
echo ""
echo "Working tree:"

uncommitted=$(git status --porcelain | wc -l)
if [ "$uncommitted" -eq 0 ]; then
    check_pass "Working tree clean"
else
    check_warn "Uncommitted changes: $uncommitted file(s)"
    echo "  Run 'git status' to see them"
fi

# Summary
echo ""
echo "================================="
echo -e "${GREEN}Passed: $PASS${NC}"
if [ "$WARN" -gt 0 ]; then
    echo -e "${YELLOW}Warnings: $WARN${NC}"
fi
if [ "$FAIL" -gt 0 ]; then
    echo -e "${RED}Failed: $FAIL${NC}"
fi
echo ""

if [ "$FAIL" -eq 0 ]; then
    echo -e "${GREEN}✓ Repository is GitHub-ready!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Review the warnings above"
    echo "  2. Run: git push -u origin main"
    exit 0
else
    echo -e "${RED}✗ Fix the failures above before pushing${NC}"
    exit 1
fi
