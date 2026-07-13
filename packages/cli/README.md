# @seldia/cli

**SelDiA CLI** — Compile, validate, init, and serve SelDiA diagram files from the command line.

## Installation

```bash
npm install -g @seldia/cli
```

Or use directly with npx:

```bash
npx @seldia/cli compile diagram.sld
```

## Commands

### `compile`

Compile a `.sld` file and render to SVG:

```bash
seldia compile diagram.sld
seldia compile diagram.sld --output diagram.svg
seldia compile diagram.sld --theme blueprint
```

### `validate`

Validate a `.sld` file for syntax and semantic errors:

```bash
seldia validate diagram.sld
```

### `serve`

Start a development server with live reload:

```bash
seldia serve diagram.sld
seldia serve diagram.sld --port 8080
```

### `init`

Scaffold a new SelDiA diagram:

```bash
seldia init my-diagram.sld
seldia init --type sequence my-sequence.sld
seldia init --type c4-context system-context.sld
```

## License

MIT
