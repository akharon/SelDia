// ============================================================
// SelDiA — Example: All diagram types showcase
// ============================================================

// State Machine
diagram state "Order Lifecycle" {
    [*] --> New: "Order placed"
    New --> Confirmed: "Payment verified"
    Confirmed --> Processing: "Warehouse picks"
    Processing --> Shipped: "Handed to carrier"
    Shipped --> Delivered: "Confirmed received"
    Delivered --> [*]
    New --> Cancelled: "Customer cancels"
}

// Class Diagram
diagram class "Payment Domain" {
    class Order {
        +id: UUID
        +total: Money
        +status: OrderStatus
        +calculateTax(): Money
    }
    class OrderItem {
        +quantity: int
        +unitPrice: Money
    }
    Order "1" --> "*" OrderItem: "contains"
}

// BPMN
diagram bpmn "Vacation Request" {
    startEvent start: "Request Submitted"
    task approve: "Manager Approves"
    endEvent end: "Approved"

    start --> approve --> end
}

// Mind Map
diagram mindmap "Project Plan" {
    root "Project"
        branch "Frontend"
            leaf "React"
            leaf "Tailwind"
        branch "Backend"
            leaf "API"
            leaf "Database"
        branch "DevOps"
            leaf "CI/CD"
            leaf "K8s"
}
