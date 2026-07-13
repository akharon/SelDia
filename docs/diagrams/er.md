# Entity Relationship Diagram

Data modeling with entities, attributes, and relationships.

## Syntax

```
diagram er "Title" {
    entity EntityName {
        field: type
    }

    Entity1 1--* Entity2
}
```

## Example

```
diagram er "Data Model" {
    entity User {
        id: UUID PK
        name: string
        email: string
    }

    entity Order {
        id: UUID PK
        userId: UUID FK
        total: decimal
    }

    entity Product {
        id: UUID PK
        name: string
        price: decimal
    }

    User 1--* Order
    Order *--* Product
}
```
