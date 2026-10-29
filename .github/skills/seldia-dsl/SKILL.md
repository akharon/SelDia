---
name: seldia-dsl
description: 'Author SelDiA (Self-Diagramming Architecture) diagrams. 25 types: flowchart, sequence, class, er, state, c4 (context/container/component), bpmn, dmn, component, usecase, activity, deployment, gantt, mindmap, network, chart (bar/line/pie/radar/scatter), gitgraph, form, sankey, block, timeline, wireframe, cloud, workitem, table (merged cells). Rough.js hand-drawn rendering. Use for any text-to-diagram .seldia/.sld files.'
argument-hint: '[diagram description or .seldia file path]'
user-invocable: true
disable-model-invocation: false
---

# SelDiA DSL — Diagram-as-Code

When the user asks to create or modify a diagram, or to write `.seldia`/`.sld` files, output ` ```seldia ` fenced blocks (raw DSL for standalone files). Pick the type from the first column:

| Need | Type keyword |
|------|--------------|
| Process/workflow | `fl` (or `flowchart`) |
| Participant interactions | `seq` (`sequence`) |
| OOP classes | `cls` (`class`) |
| DB tables & relations | `er` |
| States & transitions | `st` (`state`) |
| C4 architecture | `c4c` context / `c4con` container / `c4comp` component |
| Business process | `bpmn` |
| Decision logic | `dmn` |
| Components & deps | `comp` (`component`) |
| Actors & functions | `uc` (`usecase`) |
| Activities | `act` (`activity`) |
| Infrastructure | `deploy` (`deployment`) |
| Schedule | `gantt` |
| Brainstorming | `mind` (`mindmap`) |
| Network topology | `net` (`network`) |
| Charts | `chart bar` / `chart line` / `chart pie` / `chart radar` / `chart scatter` |
| Git history | `git` (`gitgraph`) |
| Form layouts | `form` |
| Data flow | `sankey` |
| System blocks | `block` |
| Events | `time` (`timeline`) |
| UI mockups | `wireframe` |
| Cloud/AWS topology | `cloud` |
| Requirements & traceability | `wi` (`workitem`) |
| Tables with merged cells | `table` (`tbl`) |

## Grammar

```
<type> "Title" {
    // statements: nodes, then edges
}
```

`diagram <long-type> "Title" { … }` is an accepted long form. Comments: `//` line, `/* */` block. IDs: alphanumeric + `_` + `-`, case-sensitive. One statement per line — **no semicolons**.

### Nodes

```
id [Label]              // rectangle
id (Label)              // rounded rect / start-stop
id ((Label))            // circle
id: {Label}             // diamond (decision) — needs the id: colon form
id [[Label]]            // subroutine rect
id [/Label/]            // parallelogram (I/O)
id "Label"              // default shape, quoted label (use \n for multi-line rows)
keyword id "Label" ["Description"]   // typed form: person / system / system_Ext /
                                     // component / container / database / gateway /
                                     // actor / queue / cloud / db / hex / stadium
id [Label] { x: 100, y: 50, fill: "#22aa66", stroke: "blue", textColor: "red" }
```

The colon form `id: [Label]` is also accepted for every shape. The diamond `{Label}` requires it (`check: {Valid?}`) so the brace isn't read as an attribute block.

### Edges

```
a -> b                  // directed ( --> also works)
a -> b: "Label"
a --> |"Label"| b
a -- b                  // undirected
a <-> b                 // bidirectional
a --> b --> c           // chain
a -> b: "L" { stroke: "steelblue", textColor: "red", x: 258, y: 124 }  // x/y = label position
```

### Groups & directives

```
group "Backend" {
    api [API]
    db [Database]
}
theme sketchy-dark      // sketchy-light | sketchy-dark | clean-light | clean-dark | monochrome
style { defaultNode: { fill: "#eee" } }
edges sketch            // per-diagram: sketch | clean (default clean); beats the edgeStyle config
```

### Structure lives in the label

Many types read their structure from the **label text**, not special syntax: class members and ER attributes are `\n`-separated rows inside one quoted/bracketed label; gantt dates, chart series values, sankey magnitudes, gitgraph branch names and wireframe control types are all written as words inside the label (see examples).

## Examples (all verified to compile)

### Flowchart

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

### Sequence

Participants first, then messages in order. Self-messages (`a -> a`) draw a loop.

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

### Class

Members are `\n`-rows in the label; the first row is the class name.

```seldia
cls "Core Classes" {
    Engine "Engine\n+compile(src: string): Result\n+getTheme(name: string): Theme"
    Parser "Parser\n+parse(tokens: Token[]): AST"
    Renderer "Renderer\n+render(ir: IR): string"

    Engine -> Parser: "uses"
    Engine -> Renderer: "uses"
}
```

### State Machine

`[*]` is the start/end marker; states may appear only in transitions.

```seldia
st "Order Lifecycle" {
    [*] -> Pending
    Pending -> Confirmed: "paid"
    Pending -> Cancelled: "timeout"
    Confirmed -> Shipped
    Shipped -> Delivered
}
```

### Entity–Relationship

Rows after the entity name become attribute rows; cardinality follows the arrow (`A -> B` = one A, many B).

```seldia
er "Shop" {
    Customer [Customer\nid PK\nemail string\nname string]
    Order [Order\nid PK\ncustomer_id FK\nplaced_at date]
    Product [Product\nid PK\nsku string\nprice decimal]

    Customer -> Order: "places"
    Order -> Product: "contains"
}
```

### C4 (context / container / component)

Typed declarations: `person | system | system_Ext | component | container | database` then id, label, optional description.

```seldia
c4c "Internet Banking" {
    person customer "Customer" "A bank customer"
    system banking "Internet Banking" "Manage accounts and payments"
    system_Ext mainframe "Mainframe Banking" "Core banking system"

    customer -> banking: "Views accounts, makes payments"
    banking -> mainframe: "Uses"
}
```

```seldia
c4comp "API Application" {
    person user "Customer" "Uses the web app"
    component signin "Sign In Controller" "Handles authentication"
    component security "Security Component" "Checks credentials"
    database db "Database" "Stores user credentials"

    user -> signin: "Submits credentials"
    signin -> security: "Validates"
    security -> db: "Reads from"
}
```

### BPMN

`start`, `gateway`, and plain task ids; the gateway keyword draws the decision diamond.

```seldia
bpmn "Order Fulfillment" {
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
}
```

### DMN

Inputs are plain nodes; rules carry their condition and output as label rows.

```seldia
dmn "Loan Approval" {
    age "Input: Applicant Age"
    income "Input: Annual Income"

    approve "Rule: Approve\nage >= 18 AND income > 30000\n-> APPROVE"
    denyAge "Rule: Deny (Age)\nage < 18\n-> DENY"

    age -> approve
    income -> approve
    age -> denyAge
}
```

### Component

```seldia
comp "App" {
    ui [Web UI]
    api [API Service]
    iface ((Payment Interface))
    store [Database]

    ui -> api
    api -> iface
    api -> store
}
```

### Use Case

```seldia
uc "ATM" {
    customer (Customer)
    withdraw [Withdraw Cash]
    balance [Check Balance]

    customer -> withdraw
    customer -> balance
}
```

### Activity

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

### Deployment

```seldia
deploy "Production" {
    phone [Mobile Device]
    lb [Load Balancer]
    web1 [Web Server 1]
    db [Database]

    phone -> lb
    lb -> web1
    web1 -> db
}
```

### Gantt

Dates live in the label: `[Task name: <start> - <end>]` or a single date for a milestone. The time axis granularity is chosen automatically.

```seldia
gantt "Project Alpha" {
    t1 [Requirements: Jan 6-17]
    t2 [Architecture: Jan 13-24]
    t3 [Sprint 1: Jan 27 - Feb 14]
    m1 [MVP Release: Mar 10]

    t1 -> t2
    t2 -> t3
    t3 -> m1
}
```

### Mind Map

Radial layout from the root. Children can be declared implicitly via edge labels.

```seldia
mind "System Features" {
    root "MyApp"
    frontend "Frontend"
    backend "Backend"

    root -> frontend
    frontend -> dashboard: "Dashboard"
    root -> backend
    backend -> auth: "Auth Service"
}
```

### Network

```seldia
net "Office" {
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

### Charts

Values live in the labels. Multi-series (`Name: value` pairs) gets an automatic legend.

```seldia
chart bar "Monthly Sales" {
    jan "Jan\nRevenue: 120  Costs: 80"
    feb "Feb\nRevenue: 200  Costs: 100"
    mar "Mar\nRevenue: 150  Costs: 90"
}
```

```seldia
chart pie "Market Share" {
    alpha "Alpha\n40"
    beta "Beta\n35"
    gamma "Gamma\n25"
}
```

```seldia
chart line "Weekly Active Users" {
    w1 "Wk1\nDesktop: 120  Mobile: 90"
    w2 "Wk2\nDesktop: 140  Mobile: 130"
    w3 "Wk3\nDesktop: 130  Mobile: 160"
}
```

Also `chart radar` and `chart scatter`, same label vocabulary.

### Git Graph

Branch name and message in the label: `[branch: message]`.

```seldia
git "Feature Flow" {
    main1 [main: init]
    main2 [main: release]
    feat1 [feature: work]

    main1 -> feat1
    feat1 -> main2
}
```

### Form

Field type and modifiers after the colon in the label.

```seldia
form "User Registration" {
    name [Name: text, required]
    email [Email: email, required]
    theme [Theme: Light / Dark / System]
    submit [Submit: Register]

    name -> email
    email -> theme
    theme -> submit
}
```

### Sankey

Source magnitudes in labels, flow magnitudes on edge labels; ribbon widths are proportional.

```seldia
sankey "Energy Flow" {
    solar "Solar (120)"
    wind "Wind (80)"
    grid "Electricity Grid"
    loss "Transmission Loss"

    solar -> grid: "110"
    wind -> grid: "75"
    solar -> loss: "10"
}
```

### Block

```seldia
block "Architecture" {
    cli [CLI]
    web [Web App]
    engine [Core Engine]
    render [Renderer]

    cli -> engine
    web -> engine
    engine -> render
}
```

### Timeline

```seldia
time "Roadmap" {
    q1 [Q1: MVP]
    q2 [Q2: Beta]
    q3 [Q3: GA]

    q1 -> q2
    q2 -> q3
}
```

### Wireframe

Hand-drawn UI mockups. The control type is inferred from words in the label (`button`, `field`/`input`, `textarea`, `checkbox`, `radio`, `dropdown`/`select`, `slider`, `toggle`, `progress`, `navbar`, `link`, `avatar`/`image`, `divider`, `h1`/`title`). State too: `checked`, `selected`, `on`, `70%`. Controls stack top-to-bottom in written order — edges are only for reordering and are never drawn.

```seldia
wireframe "Sign Up" {
    nav [Navbar MyApp]
    title [H1 Create your account]
    email [Email field]
    pass [Password field]
    terms [I accept the terms checkbox checked]
    upload [Upload progress 60%]
    submit [Create account button]
    forgot [Forgot password link]
}
```

### Cloud Architecture

AWS-style topologies; service kind is read from the label words (CDN, DNS, Load Balancer, EC2, RDS, Cache, Queue, Bucket/storage, security).

```seldia
cloud "Web Application on AWS" {
    user [Mobile Client]
    cdn [CloudFront CDN]
    lb [Application Load Balancer]
    api [API Server EC2]
    db [RDS Database]
    queue [SQS Queue]

    user -> cdn
    cdn -> lb
    lb -> api
    api -> db
    api -> queue
}
```

### Work Items (requirements, decisions, tests, stories)

Traceability documents: requirements, design decisions, tests, capabilities,
features, stories and risks. Each item's `type:` picks which **sections** it may
carry — a decision has `rationale`/`alternatives`/`consequences`, a story has
`acceptance`/`estimation`, a risk has `impact`/`likelihood`/`mitigation`. Every
type also has `description`/`status`/`owner`. A field that is not a section of
that type is dropped and reported, so check the type before inventing one.

Edge labels are **typed links**, not free text: `refines`, `satisfies`,
`verifies`, `derives`, `decides`, `conflicts`, `mitigates`, `depends`. The
schema enforces them — only a `test` may `verifies`, and `satisfies` must point
at a requirement or capability. Requirements and capabilities with no test
verifying them are reported as gaps. All findings are warnings; the diagram
still renders.

```seldia
wi "Payments traceability" {
    CAP1 [Customers can pay] {
        type: capability
        outcome: "Revenue is collected without manual intervention."
        measure: "Payment success rate above 98%"
    }
    REQ1 [Card payments are accepted] {
        type: requirement
        description: "A customer pays with a credit or debit card at checkout."
        justification: "Cards are 85% of attempted payments."
        priority: high
        status: approved
    }
    ADR1 [Use a hosted payment page] {
        type: decision
        rationale: "Keeps card data off our servers, reducing PCI scope."
        alternatives: "Self-hosted form with tokenisation."
        status: accepted
    }
    STORY1 [Pay with a saved card] {
        type: story
        acceptance: "Given a saved card, confirming pays the order."
        estimation: 5
    }
    TEST1 [Card payment succeeds] {
        type: test
        given: "A basket of one item and a valid test card"
        expected: "Order marked paid"
        result: passing
    }
    RISK1 [Gateway outage stops revenue] {
        type: risk
        impact: high
        likelihood: low
        mitigation: "Queue authorisations and retry."
    }

    REQ1 -> CAP1: refines
    ADR1 -> REQ1: decides
    STORY1 -> REQ1: satisfies
    TEST1 -> REQ1: verifies
    TEST1 -> CAP1: verifies
    ADR1 -> RISK1: mitigates
}
```

### Circuit

Circuit fences take a raw SPICE netlist (not DSL). The first netlist line is the title. Layout hints go in `* @seldia` comments.

```seldia
circuit
Voltage divider
V1 in 0 DC 10
R1 in out 10k
R2 out 0 4.7k
* @seldia rank in V1
.op
.end
```

### Table

A table body is GFM pipe rows, not DSL. Use the header row, an optional `|:--|:-:|--:|` alignment row, then the data rows. A cell that is exactly `^` merges into the cell above; one that is exactly `<` merges into the cell to the left. Write `\^` / `\<` for the literal characters. Do not put `^` in the header or the first body row, and do not put `<` in the first column: those show as text and raise a warning.

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

## Verify

Run `seldia check <file.sld|file.md> [--json] [--max n]` after writing a diagram. It prints `ok` or counts of readability problems (crossings, label overlaps, edges through nodes) per diagram; with `--max 0` it exits 1 if any remain. Fix by reordering declarations or splitting the diagram.

## Conventions

1. **Descriptive kebab-case IDs** — `validate-payment`, not `a1`
2. **10–30 nodes** per diagram for readability
3. **Always include a quoted title** — in the Markdown preview this becomes the diagram's numbered caption ("Diagram 3 — Payment flow"), so name it as you'd want it to read there
4. **Label decision edges** — `check -> retry: "no"`
5. **Use typed keywords for meaning** — `database db "…"` draws a cylinder, `person u "…"` an actor
6. **Use `group "…" { }`** to box related nodes
7. **Declare nodes before edges**; keep one statement per line, no semicolons
8. **Positions and colors** go in trailing attr blocks: `{ x: 100, y: 50, fill: "#c8e6c9" }`
