// SelDiA BPMN Template
// Model a business process as events, tasks and gateways.
// Shapes: (event) [task] {gateway/decision}
diagram bpmn "BPMN Process" {
    theme "sketchy-light"

    start: (Order Received)
    validate: [Validate Order]
    payment: {Payment OK?}
    ship: [Ship Order]
    refund: [Process Refund]
    done: (Order Complete)
    cancelled: (Order Cancelled)

    start --> validate
    validate --> payment
    payment -->|"yes"| ship
    payment -->|"no"| refund
    ship --> done
    refund --> cancelled
}
