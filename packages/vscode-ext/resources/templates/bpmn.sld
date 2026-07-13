diagram bpmn "BPMN Process" {
    theme "sketchy-light"

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
