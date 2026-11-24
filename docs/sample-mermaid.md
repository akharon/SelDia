# SelDiA Sample Diagrams — Mermaid

Mermaid equivalents of the diagram types in [sample.md](sample.md) that have
native Mermaid syntax. SelDiA can render these `mermaid` blocks in the VS Code
Markdown preview.

Mermaid has no native equivalents for several SelDiA diagram types. See the
coverage note at the end for the types omitted from this gallery.

## Flowchart

```mermaid
flowchart TD
    start([Start]) --> enter[Enter Credentials]
    enter --> validate{Valid Credentials?}
    validate -->|yes| dashboard[Show Dashboard]
    validate -->|no| error[Show Error Message]
    error -->|Retry| enter
    error -->|3rd attempt| lockout[Lock Account]
    dashboard --> finish([End])
    lockout --> finish
```

## Sequence Diagram

```mermaid
sequenceDiagram
    actor User
    participant App as Client App
    participant Auth as Auth Server
    participant API as Resource API

    User->>App: Click Login
    App->>Auth: GET /authorize
    Auth-->>User: Show login form
    User->>Auth: Submit credentials
    Auth-->>App: 302 Redirect with auth code
    App->>Auth: POST /token with auth code
    Auth-->>App: 200 access_token
    App->>API: GET /userinfo
    API-->>App: 200 user data
    App-->>User: Show dashboard
```

## Class Diagram

```mermaid
classDiagram
    class User {
        +UUID id
        +String email
        +login(password) Boolean
    }
    class Customer {
        +Address billingAddress
        -Integer loyaltyPoints
        +placeOrder(cart) Order
    }
    class Admin {
        +manageProducts() void
        +viewReports() Report
    }
    class Order {
        +UUID id
        +Money total
        +cancel() void
    }
    class Product {
        +String sku
        +Money price
        +Integer stock
    }
    User <|-- Customer
    User <|-- Admin
    Customer --> Order : places
    Order --> Product : references
```

## Entity-Relationship Diagram

```mermaid
erDiagram
    CUSTOMER {
        string id PK
        string email
        string name
    }
    ORDER {
        string id PK
        string customer_id FK
        date placed_at
    }
    PRODUCT {
        string id PK
        string sku
        decimal price
    }
    ORDER_ITEM {
        string order_id FK
        string product_id FK
        int quantity
    }
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--o{ ORDER_ITEM : contains
    PRODUCT ||--o{ ORDER_ITEM : appears_in
```

## State Diagram

```mermaid
stateDiagram-v2
    [*] --> Pending
    Pending --> Confirmed: paid
    Pending --> Cancelled: timeout
    Confirmed --> Shipped: dispatched
    Shipped --> Delivered: arrived
    Delivered --> [*]
    Cancelled --> [*]
```

## Gantt Chart

```mermaid
gantt
    title Project Alpha
    dateFormat YYYY-MM-DD
    Requirements :2026-01-06, 2026-01-17
    Architecture :2026-01-13, 2026-01-24
    Sprint 1 :2026-01-27, 2026-02-14
    MVP Release :milestone, 2026-03-10, 0d
```

## Mind Map

```mermaid
mindmap
  root((My Application))
    Frontend
      React SPA
      Tailwind CSS
      React Router
    Backend
      API Gateway (Kong)
        Rate Limiting
        Authentication
      Microservices
        User Service (Go)
        Order Service (Go)
      Message Queue (NATS)
    Data
      PostgreSQL
        Users DB
        Orders DB
      Redis Cache
    DevOps
      GitHub Actions
      Docker
      Kubernetes
```

## Pie Chart

```mermaid
pie title Traffic Sources (%)
    "Organic Search" : 45
    "Direct" : 25
    "Social Media" : 15
    "Referral" : 10
    "Email" : 5
```

## Git Graph

```mermaid
gitGraph
    commit id: "main init"
    branch feature
    checkout feature
    commit id: "feature work"
    checkout main
    commit id: "main release"
```

## Mermaid coverage

Mermaid does not define equivalent diagram syntax for the remaining examples
in [sample.md](sample.md): use case, activity, component, deployment, C4,
BPMN, DMN, bar/line/radar/scatter charts, network, form, Sankey, block,
timeline, circuit schematic, and tables. These are intentionally not
recast as unrelated Mermaid diagrams.
