# Sequence Diagram

Interaction diagrams showing message exchanges between participants over time.

## Syntax

```
diagram sequence "Title" {
    participant alice: Alice
    participant bob: Bob

    alice -> bob: Message
    bob --> alice: Response

    alt condition
        alice -> bob: Alternative
    else
        bob --> alice: Fallback
    end
}
```

## Example

```
diagram sequence "OAuth Flow" {
    participant browser: Browser
    participant server: Auth Server
    participant db: Database

    browser -> server: POST /login
    server -> db: SELECT user
    db --> server: user record
    server -> server: validate password

    alt success
        server --> browser: 200 + JWT
    else failure
        server --> browser: 401
    end
}
```

## Arrow Types

| Arrow | Direction |
|-------|-----------|
| `->` | Message (solid) |
| `-->` | Response (dashed) |
