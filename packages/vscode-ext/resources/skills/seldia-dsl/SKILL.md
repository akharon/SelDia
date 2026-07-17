---
name: seldia-dsl
description: 'Author SelDiA (Self-Diagramming Architecture) diagrams. 21 types: flowchart, sequence, class, er, state, usecase, activity, component, deployment, c4, bpmn, dmn, gantt, mindmap, network, chart, gitgraph, form, sankey, block, timeline. Rough.js hand-drawn rendering. Use for any text-to-diagram .sld files.'
argument-hint: '[diagram description or .sld file path]'
user-invocable: true
disable-model-invocation: false
---

# SelDiA DSL — Diagram-as-Code

## Usage

When user asks to create/modify a diagram or write `.sld` files, output ` ```seldia ` fenced blocks (raw DSL for standalone files). Choose diagram type:

| Need | Type |
|------|------|
| Process/workflow | `flowchart` |
| Participant interactions | `sequence` |
| OOP classes | `class` |
| DB tables & relations | `er` |
| States & transitions | `state` |
| Actors & functions | `usecase` |
| Activities | `activity` |
| Components & deps | `component` |
| Infrastructure | `deployment` |
| Architecture | `c4 context/container/component/code` |
| Business process | `bpmn` |
| Decision logic | `dmn` |
| Schedule | `gantt` |
| Brainstorming | `mindmap` |
| Network topology | `network` |
| Charts | `chart bar/line/pie/radar/scatter` |
| Git history | `gitgraph` |
| Data flow | `sankey` |
| System blocks | `block` |
| Events | `timeline` |
| Form layouts | `form` |

## Grammar

```
diagram <type> ["<title>"] [<metadata>] {
    theme <name>                    // sketchy-light|sketchy-dark|smooth-light|smooth-dark|high-contrast
    layout <dagre|grid|constraint> [<options>]
    style { ... }
    <body>
}
```

**Comments**: `//` line, `/* */` block. **IDs**: alphanumeric + `_` + `-`. Keywords case-insensitive, IDs case-sensitive.

### Nodes
```
id: "Label"           // default rounded rect
id: (Label)           // rounded rect     [Label] = rect
id: {Label}           // diamond          <Label> = hexagon
id: ((Label))         // circle/ellipse   |Label| = cylinder (db)
id: [/Label/]         // parallelogram    [\Label\] = reverse para
id: >Label]           // delay/flag       {{Label}} = double diamond
id shape: rectangle|diamond|cylinder|person|system|cloud|queue "Label"
id: "Label" { style: { ... } layout: { x, y } }
```

### Edges
```
a --> b               // directed
a --> b: "Label"      // with label
a --- b               // undirected
a <--> b              // bidirectional
a --> b { style: { ... } routing: { waypoints: [{x,y}] } cardinality: { source, target } }
```

### Groups & Containers
```
group "Label" { style: { fill, borderRadius } nodes... }
```

### Styling
```
style: { fill, stroke, strokeWidth, strokeStyle: solid|dashed|dotted, roughness: 0-1, fontSize, fontFamily, fontColor, cornerRadius, opacity }
```
Global: `style { defaultNode: { ... } defaultEdge: { ... } group: { ... } }`

### Layout Directives
```
layout dagre { direction: TB|LR|RL|BT, nodeSpacing, rankSpacing }
layout grid { columns: N, gap }
layout constraint { constraints: [{ type: align|sameRow|minDistance, nodes, axis, distance }] }
id: "Label" { layout: { x, y, width, height } }
a --> b { layout: { sameRow: true } }
```

## Diagram Type Examples

### Flowchart
```
diagram flowchart "Login" {
    start: (Start); input: [/Credentials/]; check: {Valid?}
    success: [Dashboard]; fail: [Error Page]; end: (End)
    start --> input; input --> check; check --> success: "Yes"
    check --> fail: "No"; fail --> input: "Retry"; success --> end
}
```

### Sequence
```
diagram sequence "Checkout" {
    participant c: "Customer" participant api: "API" participant db: "Database"
    c -> api: "Place Order"; api -> db: "INSERT"; db --> api: "order_id"
    api --> c: "Confirmed"; note right of api: "Transaction starts"
}
```

### Class (UML)
```
diagram class "Domain" {
    class User { +id:string +name:string +email:string +createOrder():Order }
    class Order { +id:string +total:number +status:OrderStatus }
    enum OrderStatus { PENDING CONFIRMED SHIPPED }
    User "1" --> "0..*" Order: "places"
}
```

### ER
```
diagram er "E-Commerce DB" {
    entity Customer { id:int PK name:varchar email:varchar UK }
    entity Order { id:int PK customer_id:int FK total:decimal }
    Customer ||--o{ Order: "places"
}
```

### State
```
diagram state "Order Lifecycle" {
    [*] --> Pending; Pending --> Confirmed: "paid"; Pending --> Cancelled
    Confirmed --> Shipped; Shipped --> Delivered; Delivered --> [*]; Cancelled --> [*]
    state Confirmed { [*] --> AwaitingStock; AwaitingStock --> ReadyToShip; ReadyToShip --> [*] }
}
```

### Use Case
```
diagram usecase "Library" {
    person m: "Member" person l: "Librarian"
    system Lib { usecase b:"Borrow" usecase r:"Return" usecase s:"Search" }
    m --> b; m --> r; m --> s; l --> b: "<<extend>>"
}
```

### Activity
```
diagram activity "Process" {
    start; :Receive Order; if (Valid?) then (yes) :Ship; else (no) :Cancel; endif; stop
}
```

### Component
```
diagram component "Microservices" {
    component web:"Web" component api:"API Gateway" component svc:"Service"
    component db:"DB" shape:cylinder
    web --> api: "REST"; api --> svc; svc --> db
}
```

### Deployment
```
diagram deployment "Production" {
    node aws:"AWS Cloud" shape:cloud { node lb:"LB" node rds:"RDS" shape:cylinder }
    node users:"Users" shape:person
    users --> aws; lb --> rds
}
```

### C4 Architecture
```
diagram c4 context "Banking" {
    person c: "Customer"; system app: "Internet Banking"
    system_Ext main: "Mainframe"; c --> app; app --> main
}
// Level 2: diagram c4 container, Level 3: diagram c4 component, Level 4: diagram c4 code
```

### BPMN
```
diagram bpmn "Vacation Request" {
    start:(Start); request:[Submit]; gate:{Available?}; approve:[Approve]; end:(End)
    start-->request; request-->gate; gate-->approve:"Yes"; gate-->delegate:"No"
    delegate-->approve; approve-->notify; notify-->end
}
```

### DMN
```
diagram dmn "Credit Score" {
    input age:number "Age" input income:number "Income"
    rule "Approve" { when: age>=25 AND income>=50000 output: "APPROVE" }
    rule "Decline" { when: income<20000 output: "DECLINE" }
}
```

### Gantt
```
diagram gantt "Sprint" {
    section "Backend" { task t1:"API" { start:"2025-01-06" duration:"3d" } }
    section "Frontend" { task t2:"UI" { start:"2025-01-06" duration:"4d" dependsOn:[t1] } }
}
```

### Mind Map
```
diagram mindmap "Plan" {
    root "Feature"
        branch "Design" { leaf "Wireframes" leaf "Mockups" }
        branch "Dev" { branch "API" { leaf "Endpoints" } leaf "DB" }
}
```

### Network
```
diagram network "Office" {
    node internet:"Internet" shape:cloud; node fw:"Firewall"
    group "DMZ" { node web:"Web Server" }
    internet --> fw; fw --> web
}
```

### Charts
```
diagram chart bar "Revenue" { data { categories:["Q1","Q2","Q3","Q4"]
    series "2024" { values:[120,145,160,190] color:"#4ecdc4" } } }
diagram chart pie "Share" { data { labels:["A","B","C"] values:[45,30,25] } }
diagram chart line "Growth" { data { x:["Jan","Feb","Mar"]
    series "Users" { values:[100,250,400] } } }
// Also: radar, scatter
```

### Git Graph
```
diagram gitgraph "Releases" {
    branch main { commit "v1.0.0" tag:"release" commit "Fix bug" }
    branch develop { commit "Feature A" commit "Feature B" }
    branch "feature/pay" from:develop { commit "Payment" merge develop:"Sync" }
    merge "feature/pay" --> develop; merge develop --> main
}
```

### Form
```
diagram form "Register" {
    field fn:text "First Name" { required:true placeholder:"John" }
    field email:email "Email" { required:true validation:"email" }
    field role:select "Role" { options:["Dev","Designer","Admin"] }
    field bio:textarea "Bio" { maxLength:500 }
    field agree:checkbox "I agree" { required:true }
    field submit:submit "Create"
    group "Personal" { fn, email }
}
```

### Sankey
```
diagram sankey "Energy" {
    source "Solar":500; source "Wind":300
    flow "Solar" --> "Residential":300; flow "Wind" --> "Industrial":150
    sink "Residential":550; sink "Losses":50
    flow "Battery" --> "Residential":150
}
```

### Block
```
diagram block "Embedded" {
    block sensor:"Temp Sensor"; block mcu:"STM32"; block cloud:"Cloud" shape:cloud
    sensor --> mcu:"I2C"; mcu --> cloud:"MQTT"
}
```

### Timeline
```
diagram timeline "History" {
    section "2018" { color:"#4ecdc4" }
    event: "Founded" date:"March 2018"
    event: "Launch" date:"Sept 2018"
    section "2019" { color:"#ff6b6b" }
    event: "Series A" date:"Jan 2019"
}
```

## Advanced Features

**Interactivity** (web/vscode): `id: "Label" { interactivity: { tooltip, href, expandable:true, children } }`

**Edge cardinality**: `customer --> order { cardinality: { source:"1", target:"0..*" } }`

## Conventions

1. **Descriptive kebab-case IDs** — `validate-payment`, not `a1`
2. **10–30 nodes** per diagram for readability
3. **Use groups** for complex diagrams
4. **Always include a title**
5. **Add edge labels** — `a --> b: "explains"`
6. **Use meaningful shapes** — cylinder=DB, person=user, cloud=external
7. **Use C4 levels** for large architectures
8. **Consistent styling via themes/global style block**
