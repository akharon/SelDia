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

Each line after the entity name becomes an attribute row, and the table is
sized to hold them. Cardinality follows the arrow: `A --> B` puts the "one"
tick on `A` and the crow's foot on `B`.

```seldia
diagram er "Shop" {
    Customer: [Customer\nid PK\nemail string\nname string]
    Order: [Order\nid PK\ncustomer_id FK\nplaced_at date]
    Product: [Product\nid PK\nsku string\nprice decimal]

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

## C4 — Component

The third C4 level: the components inside a single container. `component`,
`container`, `database` and `person` are type keywords — the shape follows the
keyword, so a `database` is drawn as a cylinder and a `person` as an actor.

```seldia
diagram c4 component "API Application" {
    person user: "Customer" "Uses the web app"
    component signin: "Sign In Controller" "Handles authentication requests"
    component accounts: "Accounts Controller" "Serves account summaries"
    component security: "Security Component" "Checks credentials"
    component facade: "Mainframe Facade" "Talks to the core banking system"
    database db: "Database" "Stores user credentials"

    user --> signin: "Submits credentials"
    signin --> security: "Validates"
    security --> db: "Reads from"
    user --> accounts: "Views balances"
    accounts --> facade: "Fetches accounts"
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
    payments: [Payment Microservice]
    iface: ((Payment Interface))
    cache: [Redis Cache]
    store: [Database]

    ui --> api
    api --> payments
    payments --> iface
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
    phone: [Mobile Device]
    lb: [Load Balancer]
    web1: [Web Server 1]
    web2: [Web Server 2]
    env: [App Container]
    jar: [order-service.jar]
    db: [Database]

    phone --> lb
    lb --> web1
    lb --> web2
    web1 --> env
    env --> jar
    web2 --> db
    jar --> db
}
```

## Gantt

The time axis granularity (day / week / month / quarter / year) is chosen
automatically from the project's total span — a two-week sprint gets daily
ticks, a multi-year roadmap gets yearly ones, with no configuration needed.

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
    internet: [Internet]
    firewall: [Firewall]
    router: [Router]
    lb: [Load Balancer]
    switch: [Switch]
    ap: [Wifi Access Point]
    pc1: [Workstation 1]
    pc2: [Workstation 2]
    server: [App Server]
    db: [Database]
    nas: [Storage NAS]

    internet --> firewall
    firewall --> router
    router --> lb
    router --> switch
    lb --> server
    switch --> ap
    switch --> pc1
    switch --> pc2
    server --> db
    server --> nas
}
```

## Chart (Bar)

Multi-series charts get an automatic legend (name → color) whenever more than
one series is present.

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

## Chart (Line)

```seldia
diagram chart line "Weekly Active Users" {
    w1: "Wk1\nDesktop: 120  Mobile: 90"
    w2: "Wk2\nDesktop: 140  Mobile: 130"
    w3: "Wk3\nDesktop: 130  Mobile: 160"
    w4: "Wk4\nDesktop: 155  Mobile: 175"

    w1 --> w2
    w2 --> w3
    w3 --> w4
}
```

## Chart (Pie)

```seldia
diagram chart pie "Market Share" {
    alpha: "Alpha\n40"
    beta: "Beta\n35"
    gamma: "Gamma\n25"
}
```

## Chart (Radar)

```seldia
diagram chart radar "Team Skills" {
    speed: "Speed\nTeamA: 8  TeamB: 6"
    power: "Power\nTeamA: 5  TeamB: 9"
    stamina: "Stamina\nTeamA: 7  TeamB: 7"
}
```

## Chart (Scatter)

```seldia
diagram chart scatter "Response Time vs Load" {
    p1: "10 req/s\nLatency: 20"
    p2: "50 req/s\nLatency: 35"
    p3: "100 req/s\nLatency: 80"
    p4: "150 req/s\nLatency: 140"
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

## Wireframe

Low-fidelity UI mockups in the hand-drawn **wired-elements** style. Every
control is sketched with a wobbly ink-on-paper line — always, regardless of the
document theme — so a wireframe is never mistaken for a finished UI. The control
type is inferred from each node's words, so no special syntax is needed:

| Control | Trigger words | Control | Trigger words |
|---------|---------------|---------|---------------|
| button | `button`, `submit`, `login`, `save`… | slider | `slider`, `range` |
| input | `input`, `field`, `email`, `search`… | dropdown | `dropdown`, `select`, `combo` |
| textarea | `textarea`, `message`, `bio` | progress | `progress`, `loading` (reads a `NN%`) |
| checkbox | `checkbox`, `terms`, `agree` | toggle | `toggle`, `switch` |
| radio | `radio`, `option` | divider | `divider`, `separator` |
| navbar | `navbar`, `menu`, `toolbar` | link | `link`, `forgot` |
| image / avatar | `image`, `logo` / `avatar` | heading | `h1`, `title`, `heading` |

State is read from the words too: a checkbox/radio with `checked` or `selected`
is filled, a toggle with `on` is switched, and a progress/slider with `70%`
fills to that fraction. Controls stack top-to-bottom in the order written —
edges are only needed to override that order and are never drawn.

```seldia
diagram wireframe "Sign Up" {
    nav: [Navbar MyApp]
    title: [H1 Create your account]
    pic: [Profile avatar]
    name: [Full name field]
    email: [Email field]
    pass: [Password field]
    bio: [Short bio textarea]
    role: [Role dropdown]
    volume: [Notification volume slider 70%]
    notify: [Enable email updates toggle on]
    terms: [I accept the terms checkbox checked]
    news: [Subscribe to newsletter checkbox]
    plan_pro: [Pro plan radio selected]
    plan_free: [Free plan radio]
    div: [divider]
    upload: [Upload progress 60%]
    submit: [Create account button]
    forgot: [Forgot password link]
}
```

## Cloud Architecture

Cloud architecture diagrams show AWS-style service topologies with region/VPC
boundaries, compute instances, storage buckets, databases, queues, CDN edges,
DNS, and users — all drawn with the same warm amber accent that reads as
"AWS Console" without mimicking their trademarked icon set.

`Google Material Symbols` are the icon source (see https://fonts.google.com/icons),
keeping the diagram vendor-neutral while staying visually familiar.

```seldia
diagram cloud "Web Application on AWS" {
  user: [Mobile Client]
  cdn: [CloudFront CDN]
  dns: [Route 53 DNS]
  lb: [Application Load Balancer]
  web: [Web Server EC2]
  api: [API Server EC2]
  worker: [Worker EC2]
  db: [RDS Database]
  cache: [ElastiCache Redis]
  queue: [SQS Queue]
  bucket: [S3 Bucket storage]
  auth: [Cognito User Pools security]

  dns --> cdn
  user --> cdn
  cdn --> lb
  lb --> web
  lb --> api
  web --> db
  api --> db
  api --> cache
  api --> queue
  worker --> queue
  worker --> bucket
  user --> auth
  auth --> api
}
```
