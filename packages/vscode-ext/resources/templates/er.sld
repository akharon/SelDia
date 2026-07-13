diagram er "Entity Relationship" {
    theme "sketchy-light"

    entity User {
        id: UUID PK
        name: string
        email: string
    }

    entity Order {
        id: UUID PK
        userId: UUID FK
        total: decimal
        created: datetime
    }

    entity Product {
        id: UUID PK
        name: string
        price: decimal
    }

    User 1--* Order
    Order *--* Product
}
