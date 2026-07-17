# @seldia/web

**SelDiA web components** — Embed SelDiA diagrams anywhere on the web using Lit-based custom elements.

`<seldia-viewer>` is the embeddable answer for anywhere GitHub's own
Markdown rendering doesn't reach: internal docs sites, wikis, a runbook page
served from your own app, a Storybook, an Electron app's help panel. It
compiles and renders SelDiA DSL client-side, in the browser, no build step
and no server round-trip beyond fetching the source file. If you only need a
static image (e.g. embedding in a GitHub-rendered `.md` file itself, which
can't run custom elements), render to SVG ahead of time instead — see the
[`seldia-render` GitHub Action](../../.github/actions/seldia-render) in the
repo root.

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
