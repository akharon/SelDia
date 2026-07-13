# BPMN Diagram

Business Process Model and Notation (BPMN 2.0 subset) for process modeling.

## Elements

| Element | Notation | Description |
|---------|----------|-------------|
| Start Event | `startEvent id: "label"` | Process start |
| End Event | `endEvent id: "label"` | Process end |
| Task | `task id: "label"` | Activity |
| Gateway | `gateway id: "label"` | Decision point |

## Example

```
diagram bpmn "Order Fulfillment" {
    startEvent start: "Order Received"
    task validate: "Validate Order"
    gateway payment: "Payment OK?"
    task ship: "Ship Order"
    task refund: "Process Refund"
    endEvent done: "Order Complete"
    endEvent cancelled: "Order Cancelled"

    start --> validate
    validate --> payment
    payment -->|yes| ship
    payment -->|no| refund
    ship --> done
    refund --> cancelled
}
```
