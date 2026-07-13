# Web Components

SelDiA provides web components for embedding diagrams in HTML pages.

## `<seldia-viewer>`

Display a rendered diagram:

```html
<seldia-viewer
    src="./diagram.sld"
    theme="sketchy-light">
</seldia-viewer>
```

## Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `src` | string | — | Path to .sld file |
| `diagram` | string | — | Inline DSL source |
| `theme` | string | sketchy-light | Theme name |
| `interactive` | boolean | false | Enable zoom/pan |
