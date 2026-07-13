# State Diagram

State machines showing states and transitions.

## Syntax

```
diagram state "Title" {
    [*] --> State1: initial
    State1 --> State2: event
    State2 --> [*]: final
}
```

## Example

```
diagram state "Order State" {
    [*] --> pending: create
    pending --> approved: approve
    pending --> cancelled: cancel
    approved --> shipped: ship
    shipped --> delivered: deliver
    delivered --> [*]: archive
}
```
