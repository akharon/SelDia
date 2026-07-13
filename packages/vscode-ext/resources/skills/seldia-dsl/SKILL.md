---
name: seldia-dsl
description: 'Author SelDiA (Self-Diagramming Architecture) diagrams using the SelDiA DSL. Use when: writing SelDiA diagram code, creating architecture diagrams, flowcharts, sequence diagrams, C4 models, BPMN, ERD, state diagrams, Gantt charts, mind maps, network diagrams, or any text-to-diagram .seldia files. Covers all 21 diagram types with hand-drawn Rough.js rendering. Trigger keywords: seldia, .seldia, diagram, flowchart, sequence diagram, class diagram, C4 model, architecture diagram, BPMN, DMN, ERD, state machine, use case, Gantt, mind map, network diagram, deployment diagram, component diagram, Sankey, git graph, block diagram, timeline, chart, form definition.'
argument-hint: '[diagram description or .seldia file path]'
user-invocable: true
disable-model-invocation: false
---

# SelDiA DSL — Diagram-as-Code Authoring

## What This Skill Does

This skill enables you to write **SelDiA DSL** — a unified, text-based Diagram-as-Code language that generates hand-drawn diagrams via Rough.js. Use this skill whenever a user asks you to create, modify, or explain a SelDiA diagram.

## When to Use

- User asks to "create a diagram", "draw a flowchart", "make an architecture diagram"
- User asks to write or edit `.seldia` files
- User asks to add a SelDiA code block (` ```seldia `) in Markdown
- User describes a system, process, or data model that needs visualization
- User asks which diagram type to use for a given scenario
- User needs to convert a description or existing diagram to SelDiA DSL

## Quick Decision: Which Diagram Type?

| User Need | SelDiA Type |
|-----------|-------------|
| Process, workflow, decision tree | `diagram flowchart "..."` |
| Participant interactions over time | `diagram sequence "..."` |
| Object-oriented class hierarchy | `diagram class "..."` |
| Database tables and relationships | `diagram er "..."` |
| States and transitions | `diagram state "..."` |
| Actors and system functions | `diagram usecase "..."` |
| System architecture (C4 model) | `diagram c4 context/container/component/code "..."` |
| Business process (BPMN) | `diagram bpmn "..."` |
| Decision logic (DMN) | `diagram dmn "..."` |
| Project timeline/schedule | `diagram gantt "..."` |
| Hierarchical brainstorming | `diagram mindmap "..."` |
| Network topology / cloud infra | `diagram network "..."` |
| Software components & dependencies | `diagram component "..."` |
| Deployment / infrastructure | `diagram deployment "..."` |
| Data visualization charts | `diagram chart bar/line/pie/radar/scatter "..."` |
| Git branch history | `diagram gitgraph "..."` |
| Form layout definition | `diagram form "..."` |
| Flow quantities (Sankey) | `diagram sankey "..."` |
| Block/system diagrams | `diagram block "..."` |
| Chronological events | `diagram timeline "..."` |

## DSL Syntax (Core Grammar)

### Top-Level Structure

```
diagram <type> ["<title>"] [<metadata>] {
    theme <theme_name>
    layout <engine> [<options>]
    style { ... }
    <diagram_body>
}
```

### Identifiers & Comments

- Identifiers: alphanumeric + `_` + `-`; quote strings with special chars
- Comments: `//` single-line, `/* */` multi-line
- Keywords are case-insensitive; identifiers are case-sensitive

### Node Declarations

```
// Basic node with ID and label
node_id: "Label Text"

// Node with shape
node_id: (Label)          // rounded rectangle
node_id: [Label]          // rectangle
node_id: {Label}          // diamond
node_id: <Label>          // hexagon
node_id: ((Label))        // circle/ellipse
node_id: [/Label/]        // parallelogram (input/output)
node_id: [\Label\]        // parallelogram reverse
node_id: |Label|          // cylinder (database)
node_id: >Label]          // delay/flag
node_id: {{Label}}        // double diamond

// Node with explicit shape keyword
node_id shape: rectangle "Label"
node_id shape: diamond "Decision"
node_id shape: cylinder "Database"
node_id shape: person "User"
node_id shape: system "My Service"
node_id shape: cloud "AWS"
node_id shape: queue "Message Queue"

// Node with style
node_id: "Label" {
    style: { fill: "#ff6b6b", stroke: "#333", roughness: 0.4 }
    layout: { x: 200, y: 300 }
}
```

### Edge Declarations

```
// Directed edges
a --> b
a --> b: "Label"
a --> b: "Label" { style: { stroke: "red", strokeWidth: 2 } }

// Undirected edges
a --- b

// Bidirectional
a <--> b

// Edge with routing
a --> b {
    style: { roughness: 0.8, strokeStyle: "dashed" }
    routing: { waypoints: [{x:100,y:50}, {x:200,y:50}] }
}

// Edge with cardinality (ER diagrams)
customer --> order: "places" {
    cardinality: { source: "1", target: "0..*" }
}
```

### Groups / Containers

```
group "Group Label" {
    style: { fill: "#f0f0f0", borderRadius: 8 }
    
    node_a: "Inside Group"
    node_b: "Also Inside"
    node_a --> node_b
}
```

### Styling

```
// Per-node style
myNode: "Label" {
    style: {
        fill: "#4ecdc4"
        stroke: "#1a535c"
        strokeWidth: 2
        strokeStyle: "solid" | "dashed" | "dotted"
        roughness: 0.5       // 0 = smooth, 1 = very sketchy
        fontSize: 14
        fontFamily: "Inter"
        fontColor: "#333"
        cornerRadius: 8
        opacity: 0.95
    }
}

// Global style block
style {
    defaultNode: { fill: "#fff", stroke: "#333", roughness: 0.4 }
    defaultEdge: { stroke: "#666", roughness: 0.5 }
}
```

### Themes

```
theme sketchy-light    // default — light background, hand-drawn feel
theme sketchy-dark     // dark background, light strokes
theme smooth-light     // clean/smooth, no Rough.js jitter
theme smooth-dark      // clean/smooth dark mode
theme high-contrast    // accessible high-contrast
```

### Layout Directives

```
layout dagre {
    direction: TB | LR | RL | BT
    nodeSpacing: 80
    rankSpacing: 120
}

// Manual position override
myNode: "Label" {
    layout: { x: 300, y: 200, width: 150, height: 60 }
}

// Edge layout hints
a --> b {
    layout: { sameRow: true }  // keep on same rank
}
```

---

## Diagram Type Reference

### 1. Flowchart

```
diagram flowchart "User Login" {
    start: (Start)
    input: [/Enter Credentials/]
    check: {Valid?}
    success: [Dashboard]
    fail: [Error Page]
    end: (End)

    start --> input
    input --> check: "Submit"
    check --> success: "Yes"
    check --> fail: "No"
    fail --> input: "Retry"
    success --> end
}
```

### 2. Sequence Diagram

```
diagram sequence "Order Checkout" {
    participant customer: "Customer"
    participant frontend: "Web App"
    participant backend: "API"
    participant db: "Database"
    participant payment: "Payment Gateway"

    customer -> frontend: "Place Order"
    frontend -> backend: "POST /orders"
    backend -> db: "INSERT order"
    db --> backend: "order_id"
    backend -> payment: "Charge $49.99"
    payment --> backend: "approved"
    backend --> frontend: "201 Created"
    frontend --> customer: "Confirmation"

    note right of backend: "Transaction starts here"
    note over customer, frontend: "User interacts with browser"
}
```

### 3. Class Diagram (UML)

```
diagram class "Payment Domain" {
    class User {
        +id: string
        +name: string
        +email: string
        +createOrder(): Order
    }

    class Order {
        +id: string
        +total: number
        +status: OrderStatus
        +calculateTax(): number
    }

    class OrderItem {
        +productId: string
        +quantity: number
        +unitPrice: number
    }

    enum OrderStatus {
        PENDING
        CONFIRMED
        SHIPPED
        DELIVERED
        CANCELLED
    }

    User "1" --> "0..*" Order: "places"
    Order "1" --> "1..*" OrderItem: "contains"
    Order --> OrderStatus: "has status"
}
```

### 4. Entity-Relationship Diagram

```
diagram er "E-Commerce DB" {
    entity Customer {
        id: int PK
        name: varchar(100)
        email: varchar(255) UK
        created_at: timestamp
    }

    entity Order {
        id: int PK
        customer_id: int FK
        total: decimal(10,2)
        status: varchar(20)
    }

    entity Product {
        id: int PK
        name: varchar(200)
        price: decimal(10,2)
        stock: int
    }

    entity OrderItem {
        order_id: int FK
        product_id: int FK
        quantity: int
        unit_price: decimal(10,2)
    }

    Customer ||--o{ Order: "places"
    Order ||--|{ OrderItem: "contains"
    Product ||--o{ OrderItem: "referenced by"
}
```

### 5. State Diagram

```
diagram state "Order Lifecycle" {
    [*] --> Pending
    Pending --> Confirmed: "payment verified"
    Pending --> Cancelled: "timeout / user cancel"
    Confirmed --> Shipped: "warehouse fulfilled"
    Shipped --> Delivered: "carrier confirms"
    Delivered --> [*]
    Cancelled --> [*]

    state Confirmed {
        [*] --> AwaitingStock
        AwaitingStock --> ReadyToShip: "stock available"
        ReadyToShip --> [*]
    }
}
```

### 6. Use Case Diagram

```
diagram usecase "Library System" {
    person member: "Library Member"
    person librarian: "Librarian"

    system LibrarySystem {
        usecase borrow: "Borrow Book"
        usecase return: "Return Book"
        usecase search: "Search Catalog"
        usecase reserve: "Reserve Book"
        usecase manage: "Manage Inventory"
    }

    member --> borrow
    member --> return
    member --> search
    member --> reserve
    librarian --> manage
    librarian --> borrow: "<<extend>>"
    reserve --> search: "<<include>>"
}
```

### 7. Activity Diagram

```
diagram activity "Order Processing" {
    start
    :Receive Order;
    if (Is payment valid?) then (yes)
        :Reserve inventory;
        :Create shipment;
        if (Is gift?) then (yes)
            :Wrap gift;
        endif
        :Ship order;
    else (no)
        :Notify customer;
        :Cancel order;
    endif
    :Send confirmation email;
    stop
}
```

### 8. Component Diagram

```
diagram component "Microservices Architecture" {
    component web: "Web Frontend" {
        port http: "HTTP :80"
    }

    component api: "API Gateway" {
        port gw: "Gateway :443"
    }

    component users: "User Service"
    component orders: "Order Service"
    component products: "Product Service"

    component db_users: "Users DB" shape: cylinder
    component db_orders: "Orders DB" shape: cylinder
    component db_products: "Products DB" shape: cylinder

    component queue: "Message Queue" shape: queue
    component cache: "Redis Cache" shape: cylinder

    web --> api: "REST"
    api --> users
    api --> orders
    api --> products
    users --> db_users
    orders --> db_orders
    products --> db_products
    orders --> queue: "events"
    products --> cache
}
```

### 9. Deployment Diagram

```
diagram deployment "Production Environment" {
    node aws: "AWS Cloud" shape: cloud {
        node lb: "Load Balancer"
        node k8s: "Kubernetes Cluster" {
            node pod1: "Web Pod"
            node pod2: "Web Pod"
            node pod3: "Worker Pod"
        }
        node rds: "RDS PostgreSQL" shape: cylinder
        node s3: "S3 Bucket" shape: cylinder
        node elasticache: "ElastiCache Redis" shape: cylinder
    }

    node cdnet: "CloudFront CDN" shape: cloud
    node users: "End Users" shape: person

    users --> cdnet: "HTTPS"
    cdnet --> lb
    lb --> pod1
    lb --> pod2
    pod1 --> rds
    pod2 --> rds
    pod3 --> elasticache
    pod3 --> s3
}
```

### 10. C4 Architecture

```
// C4 Context (Level 1)
diagram c4 context "Internet Banking" {
    person customer: "Personal Customer"
    person admin: "Bank Staff"

    system banking: "Internet Banking System" {
        description: "Allows customers to view accounts and make payments"
    }

    system_Ext mainframe: "Mainframe Banking"
    system_Ext email: "Email System"

    customer --> banking: "Views accounts, makes payments"
    admin --> banking: "Manages users"
    banking --> mainframe: "Uses"
    banking --> email: "Sends emails"
}

// C4 Container (Level 2)
diagram c4 container "Internet Banking — Containers" {
    person customer: "Customer"

    system_Ext mainframe: "Mainframe"

    container web: "Web SPA" { technology: "React + TypeScript" }
    container api: "API" { technology: "Node.js + Express" }
    container db: "Database" { technology: "PostgreSQL" shape: cylinder }
    container cache: "Cache" { technology: "Redis" shape: cylinder }

    customer --> web: "HTTPS"
    web --> api: "JSON/REST"
    api --> db: "SQL"
    api --> cache: "Read/Write"
    api --> mainframe: "XML/HTTPS"
}
```

### 11. BPMN Process

```
diagram bpmn "Vacation Request" {
    start: (Start)
    request: [Employee submits request]
    gateway: {Manager available?}
    approve: [Manager approves]
    delegate: [Delegate to backup]
    notify: [Notify employee]
    end: (End)

    start --> request
    request --> gateway
    gateway --> approve: "Yes"
    gateway --> delegate: "No"
    delegate --> approve
    approve --> notify
    notify --> end
}
```

### 12. DMN Decision Table

```
diagram dmn "Credit Score Assessment" {
    input age: number "Applicant Age"
    input income: number "Annual Income"
    input history: string "Credit History"

    rule "Auto-Approve" {
        when: age >= 25 AND income >= 50000 AND history == "good"
        output: "APPROVE"
    }

    rule "Manual Review" {
        when: age >= 21 AND income >= 30000 AND history != "poor"
        output: "REVIEW"
    }

    rule "Decline" {
        when: history == "poor" OR income < 20000
        output: "DECLINE"
    }
}
```

### 13. Gantt Chart

```
diagram gantt "Sprint 23" {
    section "Backend" {
        task t1: "API refactoring" { start: "2025-01-06", duration: "3d", assignee: "Alice" }
        task t2: "Database migration" { start: "2025-01-08", duration: "2d", assignee: "Bob" }
        task t3: "Integration tests" { start: "2025-01-10", duration: "2d", dependsOn: [t1, t2] }
    }

    section "Frontend" {
        task t4: "UI components" { start: "2025-01-06", duration: "4d", assignee: "Carol" }
        task t5: "E2E tests" { start: "2025-01-10", duration: "2d", dependsOn: [t4] }
    }

    section "DevOps" {
        task t6: "CI/CD pipeline" { start: "2025-01-06", duration: "5d", assignee: "Dave" }
    }
}
```

### 14. Mind Map

```
diagram mindmap "Project Planning" {
    root "New Feature"
        branch "Requirements"
            leaf "User stories"
            leaf "Acceptance criteria"
            leaf "Stakeholder review"
        branch "Design"
            leaf "Wireframes"
            leaf "UI mockups"
            leaf "Design review"
        branch "Development"
            branch "Backend"
                leaf "API endpoints"
                leaf "Database schema"
            branch "Frontend"
                leaf "Components"
                leaf "State management"
        branch "Testing"
            leaf "Unit tests"
            leaf "Integration tests"
            leaf "Performance tests"
}
```

### 15. Network Diagram

```
diagram network "Office Network" {
    node internet: "Internet" shape: cloud
    node fw: "Firewall"
    node sw: "Core Switch"
    node wifi: "WiFi AP"
    node server: "File Server" shape: cylinder
    node printer: "Printer"

    group "DMZ" {
        node web: "Web Server"
        node mail: "Mail Server"
    }

    group "LAN" {
        node pc1: "Workstation 1"
        node pc2: "Workstation 2"
        node laptop: "Laptop"
    }

    internet --> fw
    fw --> sw
    sw --> web
    sw --> mail
    sw --> server
    sw --> wifi
    wifi --> pc1
    wifi --> pc2
    wifi --> laptop
    sw --> printer
}
```

### 16. Charts

```
// Bar Chart
diagram chart bar "Revenue by Quarter" {
    data {
        categories: ["Q1", "Q2", "Q3", "Q4"]
        series "2024" { values: [120, 145, 160, 190] color: "#4ecdc4" }
        series "2025" { values: [135, 155, 175, 210] color: "#ff6b6b" }
    }
}

// Pie Chart
diagram chart pie "Market Share" {
    data {
        labels: ["Product A", "Product B", "Product C", "Others"]
        values: [45, 30, 15, 10]
    }
}

// Line Chart
diagram chart line "User Growth" {
    data {
        x: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
        series "Active Users" { values: [100, 250, 400, 600, 850, 1200] }
        series "New Signups" { values: [50, 150, 200, 300, 350, 500] }
    }
}
```

### 17. Git Graph

```
diagram gitgraph "Release Flow" {
    branch main {
        commit "v1.0.0" tag: "release"
        commit "Fix login bug"
        commit "v1.1.0" tag: "release"
    }

    branch develop {
        commit "Start develop"
        commit "Add feature A"
        commit "Add feature B"
    }

    branch "feature/payment" from: develop {
        commit "Payment service"
        commit "Payment tests"
        merge develop: "Sync"
        commit "Payment complete"
    }

    merge "feature/payment" --> develop: "Merge PR"
    merge develop --> main: "Release v1.1.0"
}
```

### 18. Form Definition

```
diagram form "User Registration" {
    field firstName: text "First Name" { required: true, placeholder: "John" }
    field lastName: text "Last Name" { required: true, placeholder: "Doe" }
    field email: email "Email Address" { required: true, validation: "email" }
    field password: password "Password" { required: true, minLength: 8 }
    field role: select "Role" {
        options: ["Developer", "Designer", "Manager", "Admin"]
    }
    field bio: textarea "Bio" { maxLength: 500 }
    field agree: checkbox "I agree to the terms" { required: true }
    field submit: submit "Create Account"

    group "Personal Info" {
        firstName, lastName, email
    }

    group "Security" {
        password, role
    }
}
```

### 19. Sankey Diagram

```
diagram sankey "Energy Flow" {
    source "Solar": 500
    source "Wind": 300
    source "Grid": 200

    flow "Solar" --> "Residential": 300
    flow "Solar" --> "Battery": 200
    flow "Wind" --> "Residential": 150
    flow "Wind" --> "Industrial": 150
    flow "Grid" --> "Residential": 100
    flow "Grid" --> "Commercial": 100

    sink "Residential": 550
    sink "Industrial": 150
    sink "Commercial": 100
    sink "Battery": 200
    sink "Losses": 50

    flow "Battery" --> "Residential": 150
    flow "Battery" --> "Losses": 50
}
```

### 20. Block Diagram

```
diagram block "Embedded System" {
    block sensor: "Temperature Sensor"
    block mcu: "Microcontroller (STM32)"
    block display: "OLED Display"
    block wifi: "WiFi Module"
    block power: "Power Supply"
    block cloud: "Cloud Platform" shape: cloud

    sensor --> mcu: "I2C"
    mcu --> display: "SPI"
    mcu --> wifi: "UART"
    power --> mcu: "3.3V"
    power --> sensor: "5V"
    wifi --> cloud: "MQTT"
}
```

### 21. Timeline

```
diagram timeline "Company History" {
    section "2018" { color: "#4ecdc4" }
    event: "Company founded" date: "March 2018"
    event: "First product launch" date: "September 2018"

    section "2019" { color: "#ff6b6b" }
    event: "Series A funding ($5M)" date: "January 2019"
    event: "Reached 10k users" date: "June 2019"

    section "2020" { color: "#ffe66d" }
    event: "Remote team transition" date: "March 2020"
    event: "International expansion" date: "November 2020"

    section "2021" { color: "#a8e6cf" }
    event: "Series B funding ($20M)" date: "April 2021"
    event: "50 employees" date: "December 2021"
}
```

---

## Advanced Features

### Styling at Scale

```
// Theme inheritance
diagram flowchart "Styled" {
    theme sketchy-light

    // Global defaults
    style {
        defaultNode: { fill: "#f8f9fa", stroke: "#495057", roughness: 0.4, fontSize: 13 }
        defaultEdge: { stroke: "#868e96", roughness: 0.6, strokeStyle: "solid" }
        group: { fill: "#e9ecef80", stroke: "#adb5bd", cornerRadius: 12 }
    }

    // Override per node
    critical_node: "Important" {
        style: { fill: "#ff6b6b", stroke: "#c92a2a", strokeWidth: 3 }
    }
}
```

### Layout Optimization

```
// Force direction for flowcharts
layout dagre { direction: LR }   // left to right

// Grid layout for component diagrams
layout grid { columns: 3, gap: 40 }

// Constraint-based for complex diagrams
layout constraint {
    constraints: [
        { type: "align", nodes: ["a", "b", "c"], axis: "horizontal" },
        { type: "sameRow", nodes: ["d", "e"] },
        { type: "minDistance", source: "x", target: "y", distance: 100 }
    ]
}
```

### Interactive Hints (for Web/VS Code)

```
myNode: "Click Me" {
    interactivity: {
        tooltip: "This node triggers an action"
        href: "https://docs.example.com"
        expandable: true
        children: [child1, child2]
    }
}
```

## Writing Conventions

1. **Use descriptive IDs** — `validatePayment`, `userDatabase`, not `a1`, `n2`
2. **Use kebab-case for IDs** — `payment-service`, `user-login-flow`
3. **Keep diagrams focused** — aim for 10–30 nodes for readability
4. **Use C4 levels** for large system architectures (Context → Container → Component → Code)
5. **Use groups** to organize complex diagrams visually
6. **Always include a title** — `diagram flowchart "My Title" { ... }`
7. **Add edge labels** for clarity — `a --> b: "explains relationship"`
8. **Prefer shapes that convey meaning** — cylinder for databases, person for users, cloud for external systems
9. **Use consistent styling** — define a shared theme or global style block

## Markdown Integration

When adding SelDiA diagrams to Markdown files, use fenced code blocks:

````markdown
Here is the system architecture:

```seldia
diagram c4 context "My System" {
    person user: "User"
    system app: "Application"
    user --> app: "Uses"
}
```

The system is designed for scalability.
````

## Output: Always Use Fenced Code Blocks

When generating SelDiA DSL in response to a user request, **always** wrap the diagram in a ` ```seldia ` fenced code block so it renders correctly in VS Code and Markdown previews:

````
```seldia
diagram <type> "<title>" {
    ...
}
```
````

For standalone `.seldia` files, output the raw DSL content without the fence.
