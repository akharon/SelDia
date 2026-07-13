# @seldia/web

**SelDiA web components** — Embed SelDiA diagrams anywhere on the web using Lit-based custom elements.

## Features

- 🌐 **`<seldia-viewer>`** — Render SelDiA diagrams from DSL source or URL
- 🎨 **Theme support** — All 5 built-in themes
- 🔄 **Reactive** — Auto-updates when attributes change

## Installation

```bash
npm install @seldia/web
```

## Usage

```html
<script type="module">
  import '@seldia/web';
</script>

<seldia-viewer
  source="diagram flowchart 'Hello' { start: (Start) --> end: (End) }"
  theme="sketchy-light"
></seldia-viewer>
```

Or load from a URL:

```html
<seldia-viewer
  src="/diagrams/my-diagram.sld"
  theme="blueprint"
></seldia-viewer>
```

## License

MIT
