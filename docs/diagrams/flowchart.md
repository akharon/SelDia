# Flowchart

Process flows and workflows with standard flowchart shapes.

## Syntax

```
diagram flowchart "Title" {
    start: (Start/End)
    process: [Process Step]
    decision: {Decision?}
    parallel: <Preparation>
    data: [/Data/]

    start --> process
    process --> decision
    decision -->|yes| end
    decision -->|no| process
}
```

## Example

```
diagram flowchart "User Login" {
    theme "sketchy-dark"

    start: (Start)
    login: [Enter Credentials]
    validate: {Valid?}
    dashboard: [Show Dashboard]
    error: [Show Error]

    start --> login
    login --> validate
    validate -->|yes| dashboard
    validate -->|no| error
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
