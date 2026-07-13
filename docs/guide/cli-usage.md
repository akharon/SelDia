# CLI Usage

The `seldia` CLI provides commands to compile, validate, and serve diagrams.

## Commands

### `compile`

Compile a `.sld` file to SVG:

```bash
seldia compile input.sld -o output.svg
seldia compile input.sld -o output.html --interactive
seldia compile input.sld -o output.png --scale 2
```

### `validate`

Check a `.sld` file for errors without rendering:

```bash
seldia validate input.sld
```

### `serve`

Start a live preview server with hot reload:

```bash
seldia serve input.sld --port 3000
```

### `init`

Scaffold a new diagram file:

```bash
seldia init diagram.sld
```

## Options

| Flag | Description |
|------|-------------|
| `-o, --output` | Output file path |
| `--theme` | Theme name (sketchy-light, sketchy-dark, etc.) |
| `--sketchy` | Enable/disable Rough.js sketchy style |
| `--scale` | Output scale factor (for PNG) |
| `--interactive` | Generate interactive HTML output |
| `--debug` | Print debug information |
| `--port` | Port for the serve command |
