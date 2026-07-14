# Sequence Diagram

Interaction diagrams showing message exchanges between participants over time.

## Syntax

```seldia
diagram sequence "Title" {
    participant alice: "Alice"
    participant bob: "Bob"

    alice -> bob: "Message"
    bob --> alice: "Response"
}
```

## Example

```seldia
diagram sequence "OAuth Flow" {
    participant browser: "Browser"
    participant server: "Auth Server"
    participant db: "Database"

    browser -> server: "POST /login"
    server -> db: "SELECT user"
    db --> server: "user record"
    server -> server: "validate password"

    server --> browser: "200 + JWT"
}
```

## Arrow Types

| Arrow | Direction |
|-------|-----------|
| `->` | Message (solid) |
| `-->` | Response (dashed) |
