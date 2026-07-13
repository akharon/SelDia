# Themes & Styling

## Built-in Themes

| Theme | Description |
|-------|-------------|
| `sketchy-light` | Rough.js hand-drawn on light background |
| `sketchy-dark` | Rough.js hand-drawn on dark background |
| `clean-light` | Smooth SVG on light background |
| `clean-dark` | Smooth SVG on dark background |
| `mono` | Black & white for print |

## Custom Themes

```
theme "corporate" {
    fontFamily: "Inter, sans-serif"
    fontSize: 14
    colors {
        primary: "#2563eb"
        secondary: "#7c3aed"
        background: "#ffffff"
        text: "#1e293b"
        border: "#cbd5e1"
    }
    node {
        roughness: 0.8
        bowing: 1.2
        fillStyle: "hachure"
    }
    edge {
        roughness: 1.0
        strokeWidth: 2
    }
}
```

## Inline Styles

```
node1: [Payment Service] {
    fill: "#e1f5fe",
    stroke: "#01579b",
    roughness: 1.5
}
```
