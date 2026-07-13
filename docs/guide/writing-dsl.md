# Writing DSL

SelDiA's DSL is designed to be intuitive and consistent across all diagram types.

## Basic Structure

```
diagram <type> "<title>" {
    // Comments start with //
    theme "<theme_name>"
    layout <engine> [options]

    // Nodes and edges go here
}
```

## Nodes

```
id: shape "label"

// Shapes:
(id)    — Rounded / Start-Stop
[id]    — Rectangle / Process
{id}    — Diamond / Decision
<id>    — Hexagon / Preparation
[id||]  — Database / Cylinder
{{id}}  — Subroutine
[()id]  — Stadium / Pill
[/id/]  — Parallelogram
```

## Edges

```
source --> target           // Directed
source -->|label| target    // With label
source <--> target          // Bidirectional
source --- target           // Undirected
source ..> target           // Dotted
source ==> target           // Thick
```

## Groups

```
group id "Label" {
    // Nested nodes and edges
}
```

## Comments

```
// Single line
/* Multi-line */
```

## Full Example

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
