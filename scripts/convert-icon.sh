#!/bin/bash

################################################################################
# Convert SelDiA SVG Icon to PNG
#
# This script converts the SVG icon to PNG for VS Code extension packaging
#
# Prerequisites: ImageMagick (convert command)
# Install: sudo apt-get install imagemagick  # Linux
#          brew install imagemagick           # macOS
#
# Usage: bash scripts/convert-icon.sh
################################################################################

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ICON_DIR="packages/vscode-ext/media"
SVG_FILE="$ICON_DIR/icon.svg"
PNG_FILE="$ICON_DIR/icon.png"

echo "SelDiA Icon Converter"
echo "====================="
echo ""

# Check if SVG exists
if [ ! -f "$SVG_FILE" ]; then
    echo -e "${RED}✗ SVG file not found: $SVG_FILE${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Found SVG icon${NC}"
echo "  File: $SVG_FILE"
echo "  Size: $(ls -lh "$SVG_FILE" | awk '{print $5}')"
echo ""

# Check for ImageMagick
if ! command -v convert &> /dev/null; then
    echo -e "${RED}✗ ImageMagick not found${NC}"
    echo ""
    echo "Install ImageMagick:"
    echo "  Ubuntu/Debian: sudo apt-get install imagemagick"
    echo "  macOS:         brew install imagemagick"
    echo "  Windows:       Download from https://imagemagick.org/script/download.php"
    echo ""
    exit 1
fi

echo "Converting SVG to PNG..."
echo ""

# Backup existing PNG
if [ -f "$PNG_FILE" ]; then
    cp "$PNG_FILE" "$ICON_DIR/icon-backup-$(date +%s).png"
    echo "Backed up existing PNG"
fi

# Convert SVG to PNG
# -background none: transparent background
# -size 512x512: output size
# -density 150: high quality
convert -background none -size 512x512 -density 150 "$SVG_FILE" -resize 512x512 "$PNG_FILE"

echo ""
echo -e "${GREEN}✓ Conversion complete!${NC}"
echo "  PNG File: $PNG_FILE"
echo "  Size: $(ls -lh "$PNG_FILE" | awk '{print $5}')"
echo ""

# Verify the PNG
if [ -f "$PNG_FILE" ]; then
    echo -e "${GREEN}✓ PNG icon ready for extension packaging${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. npm run build       # Build the extension"
    echo "  2. npm run package     # Create VSIX package"
    echo ""
else
    echo -e "${RED}✗ PNG creation failed${NC}"
    exit 1
fi
