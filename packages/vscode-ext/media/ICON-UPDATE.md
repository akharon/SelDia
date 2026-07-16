# VS Code Extension Icon Update

## Status: ✅ Updated

The SelDiA VS Code extension icon has been updated with a professional hand-drawn design.

### Files Updated
- **`icon.svg`** — New hand-drawn icon (6.1 KB)
  - Professional appearance matching SelDiA's sketchy aesthetic
  - Shows browser window with "SelDia" text
  - Includes pen icon, speech bubble, and diagram flow
  - Tagline: "Semantic Language for Diagram Architecture"

### Files Backed Up
- **`icon-old.svg`** — Previous icon (backup)
- **`icon-old.png`** — Previous PNG icon (backup)

### How to Generate PNG Icon

The `package.json` references `icon.png` for VS Code. To regenerate from the new SVG:

**Option 1: Using ImageMagick (Recommended)**
```bash
cd packages/vscode-ext/media
convert -background none -size 512x512 icon.svg icon.png
```

**Option 2: Using Online Converter**
1. Go to https://cloudconvert.com/svg-to-png
2. Upload `icon.svg`
3. Set size to 512×512 pixels
4. Download and replace `icon.png`

**Option 3: Using Puppeteer (Node.js)**
```bash
npm run build:icon  # (if configured in package.json)
```

### Icon Specifications

- **Size:** 512×512 pixels
- **Format:** PNG (`.png`) for package.json reference
- **Background:** Transparent
- **Style:** Hand-drawn with sketchy outlines
- **Color Palette:**
  - Cream background: `#f5f1e8`
  - Blue borders: `#5b7fa6`
  - Dark text: `#2c3e50`
  - Warm accents: `#d4a574`
  - Teal accents: `#5b9fa3`

### What's Shown in Icon

1. **Browser/Window Frame** — Represents the VS Code extension interface
2. **"SelDia" Text** — Bold, monospace font in the center
3. **Pen Icon** — Left side, represents text-based editing
4. **Speech Bubble** — Right side, represents communication/output
5. **Diagram Flow** — Bottom, shows: Input → Semantic → Architecture
   - With curved connections to a data storage oval
6. **Tagline** — "Semantic Language for Diagram Architecture"

### Testing the Icon

After generating PNG, test in VS Code:

1. Open VS Code
2. Install/reload the SelDiA extension
3. Check the extension icon in the marketplace or Extension tab
4. Verify the icon displays correctly at different sizes

### Icon Display Locations

The icon will appear in:
- ✓ VS Code Extension Marketplace
- ✓ VS Code Extensions panel (left sidebar)
- ✓ Extension details page in VS Code
- ✓ `seldia-vscode-ext.vsix` package icon

### Reverting to Old Icon

If needed, restore the previous icon:
```bash
cp icon-old.svg icon.svg
cp icon-old.png icon.png
```

### Next Steps

1. Generate PNG from SVG (using one of the methods above)
2. Test the extension with the new icon
3. Rebuild the extension: `npm run build`
4. Create the VSIX package: `npm run package`

### Notes

- The SVG is optimized and only 6.1 KB (much smaller than the old 41 KB SVG)
- PNG generation is needed for `package.json` reference and marketplace display
- The icon is designed to be recognizable at small sizes (16×16 in sidebar)
- Sketchy filter applied for aesthetic consistency with SelDiA's hand-drawn style
