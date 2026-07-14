# Flowchart

Process flows and workflows with standard flowchart shapes.

## Syntax

```seldia
diagram flowchart "Title" {
    start: (Start/End)
    process: [Process Step]
    decision: {Decision?}
    parallel: <Preparation>
    data: [/Data/]

    start --> process
    process --> decision
    decision --> end: "yes"
    decision --> process: "no"
}
```

## Example

```seldia
diagram flowchart "User Login" {
    theme sketchy-dark

    start: (Start)
    login: [Enter Credentials]
    validate: {Valid?}
    dashboard: [Show Dashboard]
    error: [Show Error]

    start --> login
    login --> validate
    validate --> dashboard: "yes"
    validate --> error: "no"
    error --> login
}
```

## Shapes

| Notation | Shape | Usage |
|----------|-------|-------|
| `(id)` | Rounded rectangle | Start/End |
| `[id]` | Rectangle | Process |
| `{id}` | Diamond | Decision |
| `<id>` | Hexagon | Preparation |
| `[/id/]` | Parallelogram | Data I/O |
