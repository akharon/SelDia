# Mind Map

Radial mind maps with hierarchical branches.

## Syntax

```
diagram mindmap "Title" {
    root "Central Topic"
        branch "Category"
            leaf "Item"
}
```

## Example

```
diagram mindmap "System Features" {
    root "MyApp"
        branch "Frontend"
            leaf "Dashboard"
            leaf "User Profile"
        branch "Backend"
            leaf "Auth Service"
            leaf "API Gateway"
        branch "DevOps"
            leaf "CI/CD"
            leaf "Monitoring"
}
```
