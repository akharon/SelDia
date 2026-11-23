# SelDiA Sample Diagrams — PlantUML

PlantUML equivalents of the diagram types in [sample.md](sample.md) that have
native PlantUML syntax. SelDiA can render these `plantuml` blocks in the VS
Code Markdown preview without Java or a PlantUML server.

Several SelDiA diagram types have no direct PlantUML equivalent. See the
coverage note at the end for the types omitted from this gallery.

## Flowchart

PlantUML has no dedicated flowchart family, so this uses a component-style
graph to preserve the nodes and labeled connections.

```plantuml
@startuml
title User Login
left to right direction

rectangle "Start" as start
rectangle "Enter Credentials" as enter
diamond "Valid Credentials?" as validate
rectangle "Show Dashboard" as dashboard
rectangle "Show Error Message" as error
rectangle "Lock Account" as lockout
rectangle "End" as finish

start --> enter
enter --> validate
validate --> dashboard : yes
validate --> error : no
error --> enter : Retry
error --> lockout : 3rd attempt
dashboard --> finish
lockout --> finish
@enduml
```

## Sequence Diagram

```plantuml
@startuml
title OAuth 2.0 Authorization Code Flow

actor User
participant "Client App" as App
participant "Auth Server" as Auth
participant "Resource API" as API

User -> App : Click Login
App -> Auth : GET /authorize
Auth --> User : Show login form
User -> Auth : Submit credentials
Auth --> App : 302 Redirect with auth code
App -> Auth : POST /token with auth code
Auth --> App : 200 access_token
App -> API : GET /userinfo
API --> App : 200 user data
App --> User : Show dashboard
@enduml
```

## Class Diagram

```plantuml
@startuml
title E-Commerce Domain

class User {
  +id: UUID
  +email: String
  +login(password: String): Boolean
}
class Customer {
  +billingAddress: Address
  -loyaltyPoints: Integer
  +placeOrder(cart: Cart): Order
}
class Admin {
  +manageProducts(): void
  +viewReports(): Report
}
class Order {
  +id: UUID
  +total: Money
  +cancel(): void
}
class Product {
  +sku: String
  +price: Money
  +stock: Integer
}

User <|-- Customer : extends
User <|-- Admin : extends
Customer --> Order : places
Order --> Product : references
@enduml
```

## Entity-Relationship Diagram

```plantuml
@startuml
title Online Shop Database

entity Customer {
  * id : uuid <<PK>>
  --
  email : string
  name : string
}
entity Order {
  * id : uuid <<PK>>
  --
  customer_id : uuid <<FK>>
  placed_at : date
}
entity Product {
  * id : uuid <<PK>>
  --
  sku : string
  price : decimal
}
entity OrderItem {
  * order_id : uuid <<FK>>
  * product_id : uuid <<FK>>
  --
  quantity : int
}

Customer ||--o{ Order : places
Order ||--o{ OrderItem : contains
Product ||--o{ OrderItem : appears_in
@enduml
```

## State Diagram

```plantuml
@startuml
title Order Lifecycle

[*] --> Pending
Pending --> Confirmed : paid
Pending --> Cancelled : timeout
Confirmed --> Shipped : dispatched
Shipped --> Delivered : arrived
Delivered --> [*]
Cancelled --> [*]
@enduml
```

## Use Case Diagram

```plantuml
@startuml
title ATM System

actor Customer
actor Bank
usecase "Withdraw Cash" as Withdraw
usecase "Check Balance" as Balance
usecase "Deposit Funds" as Deposit
usecase "Audit Log" as Audit

Customer --> Withdraw
Customer --> Balance
Customer --> Deposit
Withdraw ..> Audit : <<include>>
Withdraw --> Bank
Deposit --> Bank
@enduml
```

## Activity Diagram

```plantuml
@startuml
title Order Processing

start
:Receive Order;
:Validate Order;
if (In Stock?) then (yes)
  :Ship Order;
else (no)
  :Create Backorder;
endif
stop
@enduml
```

## Component Diagram

```plantuml
@startuml
title Microservices

[Web UI] as UI
[API Gateway] as API
[Order Service] as Orders
() "Payment Interface" as Payment
database "Database" as DB

UI --> API
API --> Orders
Orders --> Payment
Orders --> DB
@enduml
```

## Deployment Diagram

```plantuml
@startuml
title Production Environment

cloud "CDN" as cdn
node "DMZ" {
  node "Load Balancer" as lb {
    artifact "nginx" as nginx
  }
}
node "Application Tier" {
  node "App Server 1" as app1 {
    artifact "app.war" as war1
  }
  node "App Server 2" as app2 {
    artifact "app.war" as war2
  }
}
node "Database Tier" {
  node "Primary DB" as db1 {
    database "postgres-primary" as pg1
  }
  node "Replica DB" as db2 {
    database "postgres-replica" as pg2
  }
}

cdn --> lb : HTTPS
lb --> app1 : HTTP :8080
lb --> app2 : HTTP :8080
app1 --> db1 : TCP :5432
app2 --> db1 : TCP :5432
db1 --> db2 : Streaming Replication
@enduml
```

## Mind Map

```plantuml
@startmindmap
* My Application
** Frontend
*** React SPA
*** Tailwind CSS
*** React Router
** Backend
*** API Gateway (Kong)
**** Rate Limiting
**** Authentication
*** Microservices
**** User Service (Go)
**** Order Service (Go)
*** Message Queue (NATS)
** Data
*** PostgreSQL
**** Users DB
**** Orders DB
*** Redis Cache
** DevOps
*** GitHub Actions
*** Docker
*** Kubernetes
@endmindmap
```

## Gantt Chart

```plantuml
@startgantt
title Project Alpha
project starts 2026-01-06

[Requirements] starts 2026-01-06 and lasts 12 days
[Architecture] starts 2026-01-13 and lasts 12 days
[Sprint 1] starts 2026-01-27 and lasts 19 days
[MVP Release] happens at 2026-03-10
@endgantt
```

## PlantUML coverage

PlantUML has no direct equivalents for the remaining examples in
[sample.md](sample.md): C4, BPMN, DMN, bar/line/pie/radar/scatter charts,
network, form, Sankey, block, timeline, circuit schematic, and tables. They
are intentionally not recast as unrelated PlantUML diagrams.
