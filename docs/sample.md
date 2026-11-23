# SelDiA Sample Diagrams

One working example for every diagram type SelDiA supports. Each block renders in the VS Code Markdown preview, and the same DSL works in `.sld` files and with the `seldia` CLI. Syntax details are in [user_guide.md](user_guide.md#5-diagram-types).

## Flowchart

```seldia
diagram flowchart "User Login" {
    start (Start)
    enter [Enter Credentials]
    validate diamond "Valid Credentials?"
    dashboard [Show Dashboard]
    error [Show Error Message]
    lockout [Lock Account]
    end (End)

    start -> enter
    enter -> validate
    validate -> dashboard: "yes"
    validate -> error: "no"
    error -> enter: "Retry"
    error -> lockout: "3rd attempt"
    dashboard -> end
    lockout -> end
}
```

## Sequence Diagram

```seldia
diagram sequence "OAuth 2.0 Authorization Code Flow" {
    theme glow dark
    user "User"
    app "Client App"
    auth "Auth Server"
    api "Resource API"

    user -> app: "Click Login"
    app -> auth: "GET /authorize"
    auth -> user: "Show login form"
    user -> auth: "Submit credentials"
    auth -> app: "302 Redirect with auth code"
    app -> auth: "POST /token with auth code"
    auth -> app: "200 access_token"
    app -> api: "GET /userinfo"
    api -> app: "200 user data"
    app -> user: "Show dashboard"
}
```

## Class Diagram

```seldia
diagram class "E-Commerce Domain" {
    theme glow dark
    User "User\n+id: UUID\n+email: String\n+login(password: String): Boolean"
    Customer "Customer\n+billingAddress: Address\n-loyaltyPoints: Integer\n+placeOrder(cart: Cart): Order"
    Admin "Admin\n+manageProducts(): void\n+viewReports(): Report"
    Order "Order\n+id: UUID\n+total: Money\n+cancel(): void"
    Product "Product\n+sku: String\n+price: Money\n+stock: Integer"

    User -> Customer: "extends"
    User -> Admin: "extends"
    Customer -> Order: "places"
    Order -> Product: "references"
}
```

## Entity-Relationship Diagram

```seldia
diagram er "Online Shop Database" {
    Customer [Customer\nid PK\nemail string\nname string]
    Order [Order\nid PK\ncustomer_id FK\nplaced_at date]
    Product [Product\nid PK\nsku string\nprice decimal]
    OrderItem [OrderItem\norder_id FK\nproduct_id FK\nquantity int]

    Customer -> Order: "1 to many"
    Order -> OrderItem: "1 to many"
    Product -> OrderItem: "1 to many"
}
```

## State Diagram

```seldia
diagram state "Order Lifecycle" {
    [*] -> Pending
    Pending -> Confirmed: "paid"
    Pending -> Cancelled: "timeout"
    Confirmed -> Shipped: "dispatched"
    Shipped -> Delivered: "arrived"
    Delivered -> [*]
    Cancelled -> [*]
}
```

## Use Case Diagram

```seldia
diagram usecase "ATM System" {
    customer (Customer)
    bank (Bank)
    withdraw [Withdraw Cash]
    balance [Check Balance]
    deposit [Deposit Funds]
    audit [Audit Log]

    customer -> withdraw
    customer -> balance
    customer -> deposit
    withdraw -> audit: "<<include>>"
    withdraw -> bank
    deposit -> bank
}
```

## Activity Diagram

```seldia
diagram activity "Order Processing" {
    start (Start)
    receive [Receive Order]
    validate [Validate Order]
    inStock diamond "In Stock?"
    ship [Ship Order]
    backorder [Create Backorder]
    done (Done)

    start -> receive
    receive -> validate
    validate -> inStock
    inStock -> ship: "yes"
    inStock -> backorder: "no"
    ship -> done
    backorder -> done
}
```

## Component Diagram

```seldia
diagram component "Microservices" {
    ui [Web UI]
    api [API Gateway]
    orders [Order Service]
    iface ((Payment Interface))
    db [Database]

    ui -> api
    api -> orders
    orders -> iface
    orders -> db
}
```

## Deployment Diagram

```seldia
diagram deployment "Production Environment" {

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

    cloud "CDN" as cdn

    cdn --> lb: "HTTPS"
    lb --> app1: "HTTP :8080"
    lb --> app2: "HTTP :8080"
    app1 --> db1: "TCP :5432"
    app2 --> db1: "TCP :5432"
    db1 --> db2: "Streaming Replication"
}
```

## C4 — Context (Level 1)

```seldia
diagram c4 context "Internet Banking System" {

    person customer: "Personal Banking Customer" {
        description: "A customer of the bank, with personal accounts"
    }

    system bankingSystem: "Internet Banking System" {
        description: "Allows customers to view accounts and make payments"
    }

    system_Ext mainframe: "Mainframe Banking System" {
        description: "Stores all core banking information"
    }

    system_Ext email: "E-mail System" {
        description: "Internal Microsoft Exchange system"
    }

    customer --> bankingSystem: "Views accounts,\nmakes payments using"
    bankingSystem --> mainframe: "Gets account info from"
    bankingSystem --> email: "Sends e-mail using"
    email --> customer: "Sends e-mails to"
}
```

## C4 — Container (Level 2)

```seldia
diagram c4 container "Internet Banking System" {
    person customer: "Customer"

    container spa: "Single-Page Application" "React" "Provides the web interface to customers"
    container api: "Web API" "Go" "Provides banking functionality via REST/JSON"
    containerDb db: "Database" "PostgreSQL" "Stores user data and transactions"
    container cache: "Cache" "Redis" "Session and query cache"

    customer --> spa: "Visits website using"
    spa --> api: "Makes API calls to [JSON/HTTPS]"
    api --> db: "Reads from and writes to [SQL/TCP]"
    api --> cache: "Reads from and writes to [Redis Protocol]"
}
```

## C4 — Component (Level 3)

```seldia
diagram c4 component "Web API — API Application" {
    container spa: "SPA" "React"
    containerDb db: "Database" "PostgreSQL"

    component signInController: "Sign In Controller" "Go — MVC Controller" "Handles user authentication"
    component accountsController: "Accounts Controller" "Go — MVC Controller" "Provides account summaries"
    component securityComponent: "Security Component" "Go — Middleware" "JWT validation, OAuth2 flows"
    component accountRepository: "Account Repository" "Go — Repository" "Data access for accounts"

    spa --> signInController: "Signs in using [JSON/HTTPS]"
    spa --> accountsController: "Views accounts using [JSON/HTTPS]"
    signInController --> securityComponent: "Uses"
    accountsController --> securityComponent: "Uses"
    accountsController --> accountRepository: "Uses"
    accountRepository --> db: "Reads from [SQL/TCP]"
}
```

## C4 — Code (Level 4, UML class)

```seldia
diagram c4 code "Account Repository — Implementation" {
    AccountRepository "«interface» AccountRepository\n+findById(id: UUID): Account\n+save(account: Account): void\n+delete(id: UUID): void"
    PostgresAccountRepository "PostgresAccountRepository\n-db: *sql.DB\n+findById(id: UUID): Account\n+save(account: Account): void\n+delete(id: UUID): void"
    Account "Account\n+id: UUID\n+balance: Money\n+openedAt: DateTime"

    PostgresAccountRepository -> AccountRepository: "implements"
    PostgresAccountRepository -> Account: "maps to"
}
```

## BPMN Process

```seldia
diagram bpmn "Order Fulfillment Process" {
    start "Order Received"
    validate "Validate Order"
    gateway payment "Payment OK?"
    ship "Ship Order"
    refund "Process Refund"
    done "Order Complete"

    start -> validate
    validate -> payment
    payment -> ship: "yes"
    payment -> refund: "no"
    ship -> done
    refund -> done
}
```

## DMN Decision Table

```seldia
diagram dmn "Loan Approval Decision" {
    age "Input: Applicant Age"
    income "Input: Annual Income"
    approve "Rule: Approve\nage >= 18 AND income > 30000\n-> APPROVE"
    denyAge "Rule: Deny (Age)\nage < 18\n-> DENY"

    age -> approve
    income -> approve
    age -> denyAge
}
```

## Gantt Chart

```seldia
diagram gantt "Project Alpha" {
    t1 [Requirements: Jan 6-17]
    t2 [Architecture: Jan 13-24]
    t3 [Sprint 1: Jan 27 - Feb 14]
    m1 [MVP Release: Mar 10]

    t1 -> t2
    t2 -> t3
    t3 -> m1
}
```

## Mind Map

```seldia
diagram mindmap "Software Architecture" {

    root "My Application"

        branch "Frontend"
            leaf "React SPA"
            leaf "Tailwind CSS"
            leaf "React Router"

        branch "Backend"
            leaf "API Gateway (Kong)"
                leaf "Rate Limiting"
                leaf "Authentication"
            leaf "Microservices"
                leaf "User Service (Go)"
                leaf "Order Service (Go)"
            leaf "Message Queue (NATS)"

        branch "Data"
            leaf "PostgreSQL"
                leaf "Users DB"
                leaf "Orders DB"
            leaf "Redis Cache"

        branch "DevOps"
            leaf "GitHub Actions"
            leaf "Docker"
            leaf "Kubernetes"
}
```

## Network Diagram

```seldia
diagram network "Corporate Network" {
    internet [Internet]
    firewall [Firewall]
    router [Router]
    switch [Switch]
    server [App Server]

    internet -> firewall
    firewall -> router
    router -> switch
    switch -> server
}
```

## Charts

Each node is one category. The first label row is the category name; the
following rows hold `Series: value` pairs. Edges between categories are
optional and only set the order.

### Bar Chart

```seldia
diagram chart bar "Monthly Revenue 2026 (k€)" {
    jan "Jan\nRevenue: 120  Costs: 80"
    feb "Feb\nRevenue: 200  Costs: 100"
    mar "Mar\nRevenue: 150  Costs: 90"
    apr "Apr\nRevenue: 180  Costs: 95"
    may "May\nRevenue: 220  Costs: 110"
    jun "Jun\nRevenue: 250  Costs: 120"
}
```

### Line Chart

```seldia
diagram chart line "User Growth" {
    q1 "Q1\nActive: 1000  Paying: 100"
    q2 "Q2\nActive: 2500  Paying: 300"
    q3 "Q3\nActive: 5000  Paying: 800"
    q4 "Q4\nActive: 8000  Paying: 1500"
    q5 "Q5\nActive: 15000  Paying: 3000"
    q6 "Q6\nActive: 25000  Paying: 6000"

    q1 -> q2
    q2 -> q3
    q3 -> q4
    q4 -> q5
    q5 -> q6
}
```

### Pie Chart

```seldia
diagram chart pie "Traffic Sources (%)" {
    organic "Organic Search\nShare: 45"
    direct "Direct\nShare: 25"
    social "Social Media\nShare: 15"
    referral "Referral\nShare: 10"
    email "Email\nShare: 5"
}
```

### Radar Chart

```seldia
diagram chart radar "Skills Assessment" {
    js "JavaScript\nAlice: 9  Bob: 6"
    ts "TypeScript\nAlice: 8  Bob: 5"
    react "React\nAlice: 9  Bob: 7"
    node "Node.js\nAlice: 7  Bob: 9"
    devops "DevOps\nAlice: 5  Bob: 8"
    design "Design\nAlice: 4  Bob: 7"
}
```

### Scatter Chart

```seldia
diagram chart scatter "Response Time vs Load" {
    p1 "10 req/s\nLatency: 20"
    p2 "50 req/s\nLatency: 35"
    p3 "100 req/s\nLatency: 80"
    p4 "150 req/s\nLatency: 140"
    p5 "200 req/s\nLatency: 210"
}
```

## Git Graph

```seldia
diagram gitgraph "Release Workflow" {
    main1 [main: init]
    main2 [main: release]
    feat1 [feature: work]

    main1 -> feat1
    feat1 -> main2
}
```

## Form Definition

```seldia
diagram form "Employee Registration" {
    name [Name: text, required]
    email [Email: email, required]
    theme [Theme: Light / Dark / System]
    submit [Submit: Register]

    name -> email
    email -> theme
    theme -> submit
}
```

## Sankey Diagram

```seldia
diagram sankey "Energy Flow" {
    solar "Solar (120)"
    wind "Wind (80)"
    grid "Electricity Grid"
    loss "Transmission Loss"

    solar -> grid: "110"
    wind -> grid: "75"
    solar -> loss: "10"
}
```

## Block Diagram

```seldia
diagram block "Architecture" {
    cli [CLI]
    web [Web App]
    engine [Core Engine]
    render [Renderer]

    cli -> engine
    web -> engine
    engine -> render
}
```

## Timeline

```seldia
diagram timeline "Company History" {
    q1 [Q1: MVP]
    q2 [Q2: Beta]
    q3 [Q3: GA]

    q1 -> q2
    q2 -> q3
}
```

## Circuit Schematic

A `circuit` fence takes a raw SPICE netlist rather than DSL.

```seldia
circuit
RC low-pass filter
V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n
.end
```

## Table with Merged Cells

```seldia
table "Quarterly sales" {
| Region | Quarter | Revenue |
|:--|:-:|--:|
| North | Q1 | 1,200 |
| ^ | Q2 | 1,450 |
| South | Q1 | 980 |
| Total | < | 3,630 |
}
```

## Chart from a Table

```seldia
table "Revenue by region" {
| Region | 2024 | 2025 | Note |
|:--|--:|--:|:--|
| North | 1,200 | 1,450 | new store |
| South | 980 | 1,100 | |
| West | 640 | 910 | |
chart bar x=Region y=2024,2025
}
```
