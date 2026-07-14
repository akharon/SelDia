# SelDiA — Diagram Gallery

A single document demonstrating **every diagram type** SelDiA supports. Open it
in VS Code with the SelDiA extension installed and use the Markdown preview
(`Ctrl+K V`). Every diagram below is a live `seldia` code block.

## How to read this document

All diagrams share **one visual language** so they read as a single family —
but each diagram *type* also has its own visual grammar, not just a different
color:

- **Shared neutrals** — the same font, stroke weights, corner radius, fills and
  edge color are used in every diagram, regardless of type.
- **Per-type accent** — each diagram type has one signature accent color
  (flowchart = indigo, sequence = teal, ER = cyan, state = green, BPMN = orange,
  and so on) so different types are distinguishable at a glance while still
  harmonizing on the page.
- **Per-type structure** — sequence diagrams draw lifelines and ordered
  message arrows, not boxes; ER diagrams draw attributed tables with
  crow's-foot cardinality; state machines use rounded pills with a filled
  start dot; Gantt charts lay tasks on a real time axis; charts draw actual
  bar/pie geometry; mind maps radiate from a center node; Sankey diagrams draw
  proportional-width flow ribbons; Git graphs draw branch lanes with commit
  dots. Only the remaining flowchart-shaped types (flowchart, component,
  network, deployment, block, form, timeline, activity, use case) are boxes
  connected by arrows — because that's the right grammar for them.
- **Semantic roles** — meaning that crosses every diagram type gets a fixed
  color: start = green, stop/error = red, decision = amber, actor/external =
  violet, note = yellow paper.

## The three modes

Each diagram block has a toolbar with three modes:

| Mode | Icon | What it does |
|------|------|--------------|
| **Preview** | 👁 | The rendered diagram. Zoom with the toolbar or `Ctrl`+scroll. |
| **Code** | `< >` | An **editable** DSL source box. Edit the text, then click **Preview** or **Edit** — the diagram re-renders with your changes (it writes back to this Markdown file). |
| **Edit** | ✎ | **Drag** a node to move it; **double-click** a node to rename it. Changes are written back to the source. Use the auto-layout button to clear manual positions. |

---

## Flowchart

```seldia
diagram flowchart "User Login" {
    start: (Start)
    login: [Enter Credentials]
    validate: {Valid?}
    dashboard: [Show Dashboard]
    error: [Show Error]

    start --> login
    login --> validate
    validate --> dashboard: "yes"
    validate --> error: "no"
    error --> login
}
```

## Sequence

```seldia
diagram sequence "OAuth Flow" {
    participant browser: "Browser"
    participant server: "Auth Server"
    participant db: "Database"

    browser -> server: "POST /login"
    server -> db: "SELECT user"
    db --> server: "user record"
    server -> server: "validate password"
    server --> browser: "200 + JWT"
}
```

## Class

```seldia
diagram class "Core Classes" {
    CoreEngine: "CoreEngine\n+compile(source: string): Result\n+getTheme(name: string): Theme"
    Parser: "Parser\n+parse(tokens: Token[]): AST"
    Analyzer: "Analyzer\n+analyze(ast: AST): Result"
    Renderer: "Renderer\n+render(ir: IR): string"

    CoreEngine --> Parser: "uses"
    CoreEngine --> Analyzer: "uses"
    CoreEngine --> Renderer: "uses"
}
```

## State Machine

```seldia
diagram state "Interaction States" {
    [*] --> Idle
    Idle --> Selected: "click node"
    Selected --> Dragging: "drag start"
    Dragging --> Idle: "drag end"
    Selected --> Editing: "dblClick"
    Editing --> Idle: "Enter / Esc"
}
```

## Entity–Relationship

```seldia
diagram er "Shop" {
    Customer: [Customer]
    Order: [Order]
    Product: [Product]

    Customer --> Order: "places"
    Order --> Product: "contains"
}
```

## C4 — Context

```seldia
diagram c4 context "Internet Banking" {
    person customer: "Customer" "A bank customer"
    system banking: "Internet Banking" "Manage accounts and payments"
    system_Ext mainframe: "Mainframe Banking" "Core banking system"

    customer --> banking: "Views accounts, makes payments"
    banking --> mainframe: "Uses"
}
```

## C4 — Container

```seldia
diagram c4 container "System" {
    user: "User"
    web: "Web App"
    api: "API"
    db: "Database"

    user --> web
    web --> api
    api --> db
}
```

## BPMN

```seldia
diagram bpmn "Order Fulfillment" {
    startEvent start: "Order Received"
    task validate: "Validate Order"
    gateway payment: "Payment OK?"
    task ship: "Ship Order"
    task refund: "Process Refund"
    endEvent done: "Order Complete"
    endEvent cancelled: "Order Cancelled"

    start --> validate
    validate --> payment
    payment --> ship: "yes"
    payment --> refund: "no"
    ship --> done
    refund --> cancelled
}
```

## DMN — Decision Table

```seldia
diagram dmn "Loan Approval" {
    age: "Input: Applicant Age"
    income: "Input: Annual Income"
    creditScore: "Input: Credit Score"

    approve: "Rule: Approve\nage >= 18 AND income > 30000\n-> APPROVE"
    review: "Rule: Manual Review\ncreditScore <= 700\n-> REVIEW"
    denyAge: "Rule: Deny (Age)\nage < 18\n-> DENY"

    age --> approve
    income --> approve
    creditScore --> approve
    age --> denyAge
}
```

## Component

```seldia
diagram component "App" {
    ui: [Web UI]
    api: [API Service]
    cache: [Redis Cache]
    store: [Database]

    ui --> api
    api --> cache
    api --> store
}
```

## Use Case

```seldia
diagram usecase "ATM" {
    customer: (Customer)
    withdraw: [Withdraw Cash]
    balance: [Check Balance]

    customer --> withdraw
    customer --> balance
}
```

## Activity

```seldia
diagram activity "Checkout" {
    start: (Start)
    cart: [Review Cart]
    pay: [Pay]
    done: (Done)

    start --> cart
    cart --> pay
    pay --> done
}
```

## Deployment

```seldia
diagram deployment "Production" {
    lb: [Load Balancer]
    web1: [Web Server 1]
    web2: [Web Server 2]
    db: [Database]

    lb --> web1
    lb --> web2
    web1 --> db
    web2 --> db
}
```

## Gantt

```seldia
diagram gantt "Project Alpha" {
    t1: [Requirements: Jan 6-17]
    t2: [Architecture: Jan 13-24]
    t3: [Sprint 1: Jan 27 - Feb 14]
    t4: [Sprint 2: Feb 17 - Mar 7]
    m1: [MVP Release: Mar 10]

    t1 --> t2
    t2 --> t3
    t3 --> t4
    t4 --> m1
}
```

## Mind Map

```seldia
diagram mindmap "System Features" {
    root: "MyApp"
    frontend: "Frontend"
    backend: "Backend"
    devops: "DevOps"

    root --> frontend
    frontend --> dashboard: "Dashboard"
    frontend --> profile: "User Profile"
    root --> backend
    backend --> auth: "Auth Service"
    backend --> gateway: "API Gateway"
    root --> devops
    devops --> cicd: "CI/CD"
    devops --> monitoring: "Monitoring"
}
```

## Network

```seldia
diagram network "Office" {
    router: [Router]
    switch: [Switch]
    pc1: [Workstation 1]
    pc2: [Workstation 2]

    router --> switch
    switch --> pc1
    switch --> pc2
}
```

## Chart (Bar)

```seldia
diagram chart bar "Monthly Sales" {
    jan: "Jan\nRevenue: 120  Costs: 80"
    feb: "Feb\nRevenue: 200  Costs: 100"
    mar: "Mar\nRevenue: 150  Costs: 90"
    apr: "Apr\nRevenue: 180  Costs: 95"

    jan --> feb
    feb --> mar
    mar --> apr
}
```

## Git Graph

```seldia
diagram gitgraph "Feature Flow" {
    main1: [main: init]
    main2: [main: release]
    feat1: [feature: work]

    main1 --> feat1
    feat1 --> main2
}
```

## Form

```seldia
diagram form "User Registration" {
    name: [Name: text, required]
    email: [Email: email, required]
    age: [Age: number, 18-120]
    theme: [Theme: Light / Dark / System]
    submit: [Submit: Register]

    name --> email
    email --> age
    age --> theme
    theme --> submit
}
```

## Sankey

```seldia
diagram sankey "Energy Flow" {
    solar: "Solar (120)"
    wind: "Wind (80)"
    coal: "Coal (200)"
    grid: "Electricity Grid"
    storage: "Battery Storage"
    loss: "Transmission Loss"

    solar --> grid: "110"
    solar --> storage: "10"
    wind --> grid: "75"
    coal --> grid: "190"
    coal --> loss: "10"
}
```

## Block

```seldia
diagram block "SelDiA Architecture" {
    cli: [CLI]
    web: [Web App]
    vscode: [VS Code]
    engine: [Core Engine]
    layout: [Layout]
    render: [Renderer]

    cli --> engine
    web --> engine
    vscode --> engine
    engine --> layout
    layout --> render
}
```

## Timeline

```seldia
diagram timeline "Roadmap" {
    q1: [Q1: MVP]
    q2: [Q2: Beta]
    q3: [Q3: GA]
    q4: [Q4: Scale]

    q1 --> q2
    q2 --> q3
    q3 --> q4
}
```
