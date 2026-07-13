# C4 Container Diagram

Container-level view showing the high-level technical architecture.

## Syntax

```
diagram c4 container "Title" {
    container id: "Name" "Technology" "Description"
    containerDb id: "Name" "Technology" "Description"

    container --> containerDb: "Protocol"
}
```

## Example

```
diagram c4 container "Internet Banking" {
    container spa: "SPA" "React" "Client-side application"
    container api: "API" "Go" "RESTful API"
    containerDb db: "Database" "PostgreSQL" "Stores user data"

    spa --> api: "JSON/HTTPS"
    api --> db: "SQL/TCP"
}
```
