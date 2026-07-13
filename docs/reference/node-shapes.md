# Node Shapes

SelDiA supports a variety of node shapes that work across all diagram types.

## Shape Reference

| Notation | Name | Visual |
|----------|------|--------|
| `(label)` | Rounded Rectangle | Start/End, Use Case |
| `[label]` | Rectangle | Process, Component |
| `{label}` | Diamond | Decision, Gateway |
| `<label>` | Hexagon | Preparation |
| `[/label/]` | Parallelogram | Data I/O |
| `[label]` | Database Cylinder | Data Store |
| `{{label}}` | Subroutine | Predefined Process |
| `[()label]` | Stadium/Pill | Terminal |

## Custom Styles

```
node1: [Payment Service] {
    fill: "#e1f5fe",
    stroke: "#01579b",
    roughness: 1.5,
    font: "14px Caveat"
}
```
