# Class Diagram

UML class diagrams with fields, methods, and relationships.

## Syntax

```
diagram class "Title" {
    class ClassName {
        +publicField: Type
        -privateField: Type
        #protectedField: Type
        +publicMethod(): ReturnType
    }

    Class1 "1" --> "*" Class2 : label
    Class1 --> Class2 : extends >
}
```

## Example

```
diagram class "Order System" {
    class Order {
        +id: UUID
        +status: OrderStatus
        -items: List<OrderItem>
        +calculateTotal(): Money
    }

    class Customer {
        +id: UUID
        +name: string
    }

    Order "1" --> "*" OrderItem : contains >
    Order --> Customer : belongs to
}
```
