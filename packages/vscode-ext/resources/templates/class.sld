diagram class "Class Diagram" {
    theme "sketchy-light"

    class User {
        +id: UUID
        +name: string
        +email: string
        +getName(): string
    }

    class Order {
        +id: UUID
        +total: Money
        +status: string
    }

    User "1" --> "*" Order
}
