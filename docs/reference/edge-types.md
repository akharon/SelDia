# Edge Types

## Arrow Reference

| Notation | Type | Direction |
|----------|------|-----------|
| `-->` | Solid arrow | Directed |
| `<-->` | Solid arrow | Bidirectional |
| `---` | Solid line | Undirected |
| `..>` | Dotted arrow | Directed |
| `==>` | Thick arrow | Directed |
| `-..->` | Dashed arrow | Directed |
| `..` | Dotted line | Undirected |

## Labels

```
a -->|label| b
a --> b "label"
```

## Routing Hints

```
a -->[left] b         // Route left
a -->[right, curved] b  // Curved routing
```
