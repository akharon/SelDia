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

## Viewing and editing

In the **Markdown preview**, each diagram block has a hover toolbar with two
modes — the preview itself is read-only:

| Mode | Icon | What it does |
|------|------|--------------|
| **Preview** | 👁 | The rendered diagram. Zoom with the toolbar or `Ctrl`+scroll; grab-to-pan when zoomed. |
| **Code** | `< >` | The DSL source, read-only, with copy-to-clipboard and an "open in editor" jump to this fence. |

To **edit visually**, use the **✎ Edit Visually** CodeLens above any fence in
the raw Markdown: it opens an interactive panel where you can drag nodes,
double-click to rename, right-click for style/add/delete, and undo/redo —
every change is written straight back into this fence (save the file to
persist it to disk).

---

## Flowchart

```seldia
fl "User Login" {
    start (Start)
    login [Enter Credentials]
    validate diamond "Valid?"
    dashboard [Show Dashboard]
    error [Show Error]

    start -> login
    login -> validate
    validate -> dashboard: "yes"
    validate -> error: "no"
    error -> login
}
```

## Sequence

```seldia
seq "OAuth Flow" {
browser "Browser"
server "Auth Server"
db "Database"

    browser -> server: "POST /login"
    server -> db: "SELECT user"
    db -> server: "user record"
    server -> server: "validate password"
    server -> browser: "200 + JWT"
}
```

## Class

```seldia
cls "Core Classes" {
    CoreEngine "CoreEngine\n+compile(source: string): Result\n+getTheme(name: string): Theme"
    Parser "Parser\n+parse(tokens: Token[]): AST"
    Analyzer "Analyzer\n+analyze(ast: AST): Result"
    Renderer "Renderer\n+render(ir: IR): string"

    CoreEngine -> Parser: "uses"
    CoreEngine -> Analyzer: "uses"
    CoreEngine -> Renderer: "uses"
}
```

## State Machine

```seldia
st "Interaction States" {
    [*] -> Idle
    Idle -> Selected: "click node"
    Selected -> Dragging: "drag start"
    Dragging -> Idle: "drag end"
    Selected -> Editing: "dblClick"
    Editing -> Idle: "Enter / Esc"
}
```

## Entity–Relationship

Each line after the entity name becomes an attribute row, and the table is
sized to hold them. Cardinality follows the arrow: `A --> B` puts the "one"
tick on `A` and the crow's foot on `B`.

```seldia
er "Shop" {
    Customer [Customer\nid PK\nemail string\nname string]
    Order [Order\nid PK\ncustomer_id FK\nplaced_at date]
    Product [Product\nid PK\nsku string\nprice decimal]

    Customer -> Order: "places"
    Order -> Product: "contains"
}
```

## C4 — Context

```seldia
c4c "Internet Banking" {
    person customer "Customer" "A bank customer"
    system banking "Internet Banking" "Manage accounts and payments"
    system_Ext mainframe "Mainframe Banking" "Core banking system"

    customer -> banking: "Views accounts, makes payments"
    banking -> mainframe: "Uses"
}
```

## C4 — Container

```seldia
c4con "System" {
    user "User"
    web "Web App"
    api "API"
    db "Database"

    user -> web
    web -> api
    api -> db
}
```

## C4 — Component

The third C4 level: the components inside a single container. `component`,
`container`, `database` and `person` are type keywords — the shape follows the
keyword, so a `database` is drawn as a cylinder and a `person` as an actor.

```seldia
c4comp "API Application" {
    person user "Customer" "Uses the web app"
    component signin "Sign In Controller" "Handles authentication requests"
    component accounts "Accounts Controller" "Serves account summaries"
    component security "Security COmponent" "Checks credentials"
    component facade "Mainframe Facade" "Talks to the core banking system"
    database db "Database" "Stores user credentials"

    user -> signin: "Submits credentials" { x: 258, y: 124 }
    signin -> security: "Validates" { stroke: "steelblue", textColor: "red" }
    security -> db: "Reads from" { x: 870, y: 134 }
    user -> accounts: "Views balances"
    accounts -> facade: "Fetches accounts"
}
```

## BPMN

```seldia
bpmn "Order Fulfillment" {
    start "Order Received"
    validate "Validate Order"
    gateway payment "Payment OK?"
    ship "Ship Order"
    refund "Process Refund"
    done "Order Complete"
    cancelled "Order Cancelled"

    start -> validate
    validate -> payment
    payment -> ship: "yes"
    payment -> refund: "no"
    ship -> done
    refund -> cancelled
}
```

## DMN — Decision Table

```seldia
dmn "Loan Approval" {
    age "Input: Applicant Age"
    income "Input: Annual Income"
    creditScore "Input: Credit Score"

    approve "Rule: Approve\nage >= 18 AND income > 30000\n-> APPROVE"
    review "Rule: Manual Review\ncreditScore <= 700\n-> REVIEW"
    denyAge "Rule: Deny (Age)\nage < 18\n-> DENY"

    age -> approve
    income -> approve
    creditScore -> approve
    age -> denyAge
}
```

## Component

```seldia
comp "App" {
    ui [Web UI]
    api [API Service]
    payments [Payment Microservice]
    iface ((Payment Interface))
    cache [Redis Cache]
    store [Database]

    ui -> api
    api -> payments
    payments -> iface
    api -> cache
    api -> store
}
```

## Use Case

```seldia
uc "ATM" {
    customer (Customer)
    withdraw [Withdraw Cash]
    balance [Check Balance]

    customer -> withdraw
    customer -> balance
}
```

## Activity

```seldia
act "Checkout" {
    start (Start)
    cart [Review Cart]
    pay [Pay]
    done (Done)

    start -> cart
    cart -> pay
    pay -> done
}
```

## Deployment

```seldia
deploy "Production" {
    phone [Mobile Device]
    lb [Load Balancer]
    web1 [Web Server 1]
    web2 [Web Server 2]
    env [App Container]
    jar [order-service.jar]
    db [Database]

    phone -> lb
    lb -> web1
    lb -> web2
    web1 -> env
    env -> jar
    web2 -> db
    jar -> db
}
```

## Gantt

The time axis granularity (day / week / month / quarter / year) is chosen
automatically from the project's total span — a two-week sprint gets daily
ticks, a multi-year roadmap gets yearly ones, with no configuration needed.

```seldia
gantt "Project Alpha" {
    t1 [Requirements: Jan 6-17]
    t2 [Architecture: Jan 13-24]
    t3 [Sprint 1: Jan 27 - Feb 14]
    t4 [Sprint 2: Feb 17 - Mar 7]
    m1 [MVP Release: Mar 10]

    t1 -> t2
    t2 -> t3
    t3 -> t4
    t4 -> m1
}
```

## Mind Map

```seldia
mind "System Features" {
    root "MyApp"
    frontend "Frontend"
    backend "Backend"
    devops "DevOps"

    root -> frontend
    frontend -> dashboard: "Dashboard"
    frontend -> profile: "User Profile"
    root -> backend
    backend -> auth: "Auth Service"
    backend -> gateway: "API Gateway"
    root -> devops
    devops -> cicd: "CI/CD"
    devops -> monitoring: "Monitoring"
}
```

## Network

```seldia
net "Office" {
    internet [Internet]
    firewall [Firewall] { textColor: "red" }
    router [Router] { fill: "red" }
    lb [Load Balancer]
    switch [SwitcH]
    ap [Wifi Access Point]
    pc1 [Workstation 1]
    pc2 [Workstation 2]
    server [App Server]
    db [Database]
    nas [Storage NAS]

    internet -> firewall
    firewall -> router
    router -> lb
    router -> switch
    lb -> server
    switch -> ap
    switch -> pc1
    switch -> pc2
    server -> db
    server -> nas
}
```

## Chart (Bar)

Multi-series charts get an automatic legend (name → color) whenever more than
one series is present.

```seldia
chart bar "Monthly Sales" {
    jan "Jan\nRevenue: 120  Costs: 80"
    feb "Feb\nRevenue: 200  Costs: 100"
    mar "Mar\nRevenue: 150  Costs: 90"
    apr "Apr\nRevenue: 180  Costs: 95"

    jan -> feb
    feb -> mar
    mar -> apr
}
```

## Chart (Line)

```seldia
chart line "Weekly Active Users" {
    w1 "Wk1\nDesktop: 120  Mobile: 90"
    w2 "Wk2\nDesktop: 140  Mobile: 130"
    w3 "Wk3\nDesktop: 130  Mobile: 160"
    w4 "Wk4\nDesktop: 155  Mobile: 175"

    w1 -> w2
    w2 -> w3
    w3 -> w4
}
```

## Chart (Pie)

```seldia
chart pie "Market Share" {
    alpha "Alpha\n40"
    beta "Beta\n35"
    gamma "Gamma\n25"
}
```

## Chart (Radar)

```seldia
chart radar "Team Skills" {
    speed "Speed\nTeamA: 8  TeamB: 6"
    power "Power\nTeamA: 5  TeamB: 9"
    stamina "Stamina\nTeamA: 7  TeamB: 7"
}
```

## Chart (Scatter)

```seldia
chart scatter "Response Time vs Load" {
    p1 "10 req/s\nLatency: 20"
    p2 "50 req/s\nLatency: 35"
    p3 "100 req/s\nLatency: 80"
    p4 "150 req/s\nLatency: 140"
}
```

## Git Graph

```seldia
git "Feature Flow" {
    main1 [main: init]
    main2 [main: release]
    feat1 [feature: work]

    main1 -> feat1
    feat1 -> main2
}
```

## Form

```seldia
form "User Registration" {
    name [Name: text, required]
    email [Email: email, required]
    age [Age: number, 18-120]
    theme [Theme: Light / Dark / System]
    submit [Submit: Register]

    name -> email
    email -> age
    age -> theme
    theme -> submit
}
```

## Sankey

```seldia
sankey "Energy Flow" {
    solar "Solar (120)"
    wind "Wind (80)"
    coal "Coal (200)"
    grid "Electricity Grid"
    storage "Battery Storage"
    loss "Transmission Loss"

    solar -> grid: "110"
    solar -> storage: "10"
    wind -> grid: "75"
    coal -> grid: "190"
    coal -> loss: "10"
}
```

## Block

```seldia
block "SelDiA Architecture" {
    cli [CLI]
    web [Web App]
    vscode [VS Code]
    engine [Core Engine]
    layout [Layout]
    render [Renderer]

    cli -> engine
    web -> engine
    vscode -> engine
    engine -> layout
    layout -> render
}
```

## Timeline

```seldia
time "Roadmap" {
    q1 [Q1: MVP]
    q2 [Q2: Beta]
    q3 [Q3: GA]
    q4 [Q4: Scale]

    q1 -> q2
    q2 -> q3
    q3 -> q4
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
wireframe "Sign Up" {
    nav [Navbar MyApp]
    title [H1 Create your account]
    pic [Profile avatar]
    name [Full name field]
    email [Email field]
    pass [Password field]
    bio [Short bio textarea]
    role [Role dropdown]
    volume [Notification volume slider 70%]
    notify [Enable email updates toggle on]
    terms [I accept the terms checkbox checked]
    news [Subscribe to newsletter checkbox]
    plan_pro [Pro plan radio selected]
    plan_free [Free plan radio]
    div [divider]
    upload [Upload progress 60%]
    submit [Create account button]
    forgot [Forgot password link]
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
cloud "Web Application \non AWS" {
  user [Mobile Client]
  cdn [CloudFront CDN]
  dns [Route 53 DNS]
  lb [Application \nLoad Balancer]
  web [Web Server EC2]
  api [API Server EC2]
  worker [Worker EC2]
  db [RDS Database]
  cache [ElastiCache \nRedis]
  queue [SQS Queue]
  bucket [S3 Bucket storage]
  auth [Cognito User \nPools security] { stroke: "blue" }

  dns -> cdn
  user -> cdn
  cdn -> lb
  lb -> web
  lb -> api
  web -> db
  api -> db
  api -> cache
  api -> queue
  worker -> queue
  worker -> bucket
  user -> auth
  auth -> api
}
```

---

## Work Items — requirements, decisions, tests and stories

A documentation / traceability diagram. Each item is a **card** whose sections
depend on its type — a decision carries a rationale and alternatives, a story
carries acceptance criteria and points, a risk carries impact and likelihood.
Items are joined by **typed links** (`satisfies`, `verifies`, `refines`,
`decides`, `mitigates`, `derives`, `conflicts`, `depends`).

Unlike the other diagram types, this one can be *wrong*: the schema knows that
only a test may `verify` something and that `satisfies` must point at a
requirement or capability, so a mis-modelled link is reported rather than
quietly drawn. Requirements with no test covering them are reported too — the
question a traceability diagram exists to answer.

```seldia
wi "Checkout traceability" {
  CAP1 [Customers can pay] {
    type: capability
    description: "Accept payment for a basket and issue a receipt."
    outcome: "Revenue is collected without manual intervention."
    measure: "Payment success rate above 98%"
    status: active
    owner: "commerce"
  }

  REQ1 [Card payments are accepted] {
    type: requirement
    description: "A customer pays with a credit or debit card at checkout."
    justification: "Cards are 85% of attempted payments in our market."
    priority: high
    verification: "Automated end-to-end test against the sandbox gateway"
    status: approved
  }

  ADR1 [Use a hosted payment page] {
    type: decision
    rationale: "Keeps card data off our servers, reducing PCI scope to SAQ-A."
    alternatives: "Self-hosted form with tokenisation; direct API integration."
    consequences: "Less control over checkout styling; a redirect in the flow."
    status: accepted
    date: "2026-04-02"
  }

  STORY1 [Pay with a saved card] {
    type: story
    description: "A returning customer selects a stored card and confirms."
    acceptance: "Given a saved card, when the customer confirms, the order is paid."
    estimation: 5
    startDate: "2026-04-13"
    status: "in progress"
  }

  TEST1 [Card payment succeeds end to end] {
    type: test
    given: "A basket of one item and a valid test card"
    expected: "Order marked paid and a receipt email is queued"
    result: passing
  }

  RISK1 [Gateway outage stops all revenue] {
    type: risk
    impact: high
    likelihood: low
    mitigation: "Queue authorisations and retry; show a status banner."
  }

  REQ1 -> CAP1: refines
  ADR1 -> REQ1: decides
  STORY1 -> REQ1: satisfies
  TEST1 -> REQ1: verifies
  TEST1 -> CAP1: verifies
  ADR1 -> RISK1: mitigates
  STORY1 -> ADR1: derives
}
```

---

## Floorplan — 2D architectural layout

A precise technical drawing, not a graph: rooms are placed at explicit metre
coordinates, **walls are never authored** — they're derived automatically
wherever room rectangles touch (interior) or don't (exterior) — and doors,
windows and furniture are cut into or dropped onto a room by name. Furniture
items pull default sizes from a built-in catalog (`sink`, `bed-queen`, `sofa`,
`stairs-turn`, …) unless a `size` override is given. Renders with crisp lines
inside a bordered blueprint frame with a title-block stamp, not the hand-drawn
Rough.js style every other type uses.

```seldia
fp "Apartment 4B" {
  meta [sheet] { type: sheet, scale: "1:100", author: "M. Kiyar", date: "2026-09-08" }

  Kitchen "Kitchen" { type: room, at: "0,0", size: "4x3" }
  Living "Living" { type: room, at: "4,0", size: "6x3" }
  Bedroom "Bedroom" { type: room, at: "0,3", size: "4x5" }
  Bathroom "Bathroom" { type: room, at: "4,3", size: "3x2" }

  d1 [door] { type: door, at: "Kitchen.east", offset: 1.5, width: 0.9 }
  d2 [door] { type: door, at: "Living.south", offset: 5.2, width: 0.9 }
  d3 [door] { type: door, at: "Bathroom.west", offset: 0.3, width: 0.8 }
  w1 [window] { type: window, at: "Bedroom.west", offset: 2, width: 1.2 }
  w2 [window] { type: window, at: "Living.north", offset: 3, width: 1.5 }

  f1 [sink] { type: furniture, item: sink, in: "Kitchen", at: "0.2,0.2" }
  f2 [stove] { type: furniture, item: stove, in: "Kitchen", at: "0.9,0.2" }
  f3 [fridge] { type: furniture, item: fridge, in: "Kitchen", at: "3.1,0.2" }
  f4 [counter] { type: furniture, item: counter, in: "Kitchen", at: "1.6,0.2", x: 251, y: 156 }
  f5 [island] { type: furniture, item: "dining-table", in: "Kitchen", at: "1.3,1.6", size: "1.4x0.8", x: 212, y: 289 }
  f16 [chair1] { type: furniture, item: chair, in: "Kitchen", at: "1.45,2.45", rotation: 0 }
  f17 [chair2] { type: furniture, item: chair, in: "Kitchen", at: "2.05,2.45", rotation: 0 }
  f18 [chair3] { type: furniture, item: chair, in: "Kitchen", at: "2.85,1.75", rotation: 90 }

  kitch "" { type: measure, from: "f5", to: "f4" }

  f6 [sofa] { type: furniture, item: sofa, in: "Living", at: "0.4,0.9", size: "2.0x0.9", x: 400, y: 187 }
  f7 [coffee-table] { type: furniture, item: "coffee-table", in: "Living", at: "0.6,2.0" }
  f8 [tv-table] { type: furniture, item: "tv-table", in: "Living", at: "0.5,0.15" }
  f9 [rug] { type: furniture, item: "carpet-small", in: "Living", at: "2.6,0.5" }
  f20 [radiator1] { type: furniture, item: radiator, in: "Living", at: "2.6,0.05" }

  f10 [bed] { type: furniture, item: "bed-queen", in: "Bedroom", at: "0.3,0.3", x: 177, y: 357 }
  f11 [wardrobe] { type: furniture, item: wardrobe, in: "Bedroom", at: "2.35,3.86", x: 289, y: 543 }
  f12 [dresser] { type: furniture, item: wardrobe, in: "Bedroom", at: "0.3,3.9", size: "1.4x0.5", x: 214, y: 501 }
  f21 [radiator2] { type: furniture, item: radiator, in: "Bedroom", at: "0,2.4", size: "0.12x1.0" }

  f13 [sink-bath] { type: furniture, item: "sink-bath", in: "Bathroom", at: "2.4,0.25" }
  f14 [toilet] { type: furniture, item: toilet, in: "Bathroom", at: "2.5,1.3" }
  f15 [bathtub] { type: furniture, item: bathtub, in: "Bathroom", at: "0.1,1.15" }
  f22 [ufh-bath] { type: furniture, item: "floor-heating", in: "Bathroom", at: "0.55,0.9", size: "1.9x1" }

  mBathH "" { type: measure, from: "Bathroom.south", to: "Bathroom.north" }
    node25: [New Node 25]
    f3 --> f6
    f12 --> f10
}
```
