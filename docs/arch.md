# SelDiA — Self-Diagramming Architecture

> **A unified, text-based Diagram-as-Code tool with hand-drawn aesthetics powered by Rough.js**

---

## Table of Contents

1. [Name & Identity](#1-name--identity)
2. [Project Vision & Goals](#2-project-vision--goals)
3. [DSL Design — The SelDiA Language](#3-dsl-design--the-seldia-language)
4. [Architecture Overview](#4-architecture-overview)
5. [Package-Level Design](#5-package-level-design)
6. [Plugin System](#6-plugin-system)
7. [Layout Engine](#7-layout-engine)
8. [Renderer — Rough.js Integration](#8-renderer--roughjs-integration)
9. [Interaction Layer](#9-interaction-layer)
10. [CLI, Web & VS Code Extension](#10-cli-web--vs-code-extension)
11. [Folder Structure](#11-folder-structure)
12. [Technology Stack](#12-technology-stack)
13. [Key Design Decisions & Rationale](#13-key-design-decisions--rationale)
14. [Implementation Plan](#14-implementation-plan)
15. [Security, Performance & Accessibility](#15-security-performance--accessibility)

---

## 1. Name & Identity

**SelDiA** stands for **Sel**f-**Di**agramming **A**rchitecture.

- "Self" — embodies the Diagram-as-Code philosophy: you describe, it draws.
- "Diagramming" — the core purpose.
- "Architecture" — signals support for C4, deployment, component, and enterprise architecture diagrams.

**Tagline:** *Describe. Sketch. Reveal.*

---

## 2. Project Vision & Goals

### 2.1 Core Vision

A single, unified tool that replaces the fragmented ecosystem of PlantUML, Mermaid, Structurizr, D2, C4-PlantUML, bpmn-js, dmn-js, form-js, and chart.js — with a clean, consistent DSL and the distinctive hand-drawn aesthetic of Rough.js.

### 2.2 Design Goals

| Goal | Description |
|------|-------------|
| **Unified DSL** | One language for all diagram types — no context-switching between syntaxes |
| **Hand-drawn aesthetic** | All diagrams rendered with Rough.js for a sketchy, human feel |
| **Pluggable** | Diagram types are plugins; the core is lean |
| **Headless & Embeddable** | Works as CLI, lib, web component, VS Code extension |
| **Auto-layout** | Intelligent layout with manual override capability |
| **Interactive** | Zoom, pan, select, tooltip, expand/collapse in web contexts |
| **Standard output** | SVG (primary), PNG, PDF, HTML interactive |
| **Accessible** | Screen-reader friendly with ARIA annotations |

### 2.3 Diagram-Type Coverage

SelDiA covers **all** diagram types from the reference tools:

| Category | Diagram Types | Inspired By |
|----------|--------------|-------------|
| **Structural** | Class, Object, ERD, Component, Deployment, Block | PlantUML, Mermaid, D2 |
| **Behavioral** | Sequence, Activity, State, Use Case | PlantUML, Mermaid |
| **Architecture** | C4 (Context→Container→Component→Code) | Structurizr, C4 |
| **Flow & Process** | Flowchart, BPMN 2.0, DMN | PlantUML, bpmn-js, dmn-js |
| **Data Visualization** | Bar, Line, Pie, Radar, Scatter, Sankey | chart.js, Mermaid |
| **Project Management** | Gantt, Timeline, WBS, MindMap | PlantUML, Mermaid |
| **Network & Infra** | Network, Deployment, Cloud Architecture | PlantUML, D2 |
| **Git** | Git Graph / Git Branch | Mermaid |
| **Forms** | Form Definition | form-js |

---

## 3. DSL Design — The SelDiA Language

### 3.1 Design Philosophy

1. **Progressive disclosure** — simple diagrams are one-liners; complex ones have full expressiveness.
2. **Consistent grammar** — `key: value` pairs, `{}` blocks, `->` arrows feel familiar.
3. **Whitespace-insensitive** — indentation is for readability only, not semantics (unlike YAML).
4. **Comments** — `//` single-line, `/* */` multi-line.
5. **Identifiers** — alphanumeric + `_` + `-`; quoted strings for special chars.
6. **URL-friendly** — encode diagrams in URLs for sharing.

### 3.2 Top-Level Structure

```
diagram <type> ["<title>"] [<metadata>] {
    theme <theme_name>
    layout <engine> [<options>]
    style { ... }
    <diagram_body>
}
```

**Example (Flowchart):**
```seldia
diagram flowchart "User Login" {
    theme sketchy-dark

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

### 3.3 Unified Node Syntax

All diagram types share a common node declaration syntax:

```
<id> ":" <shape> ["<label>"] [<style_block>]

// Shapes (uniform across types):
()    Rounded rectangle / Start-Stop
[]    Rectangle / Process
{}    Diamond / Decision
<>    Hexagon / Preparation
[]    Parallelogram / I/O (use [/ ... /] or [\ ... \])
()    Circle / Connector
[||]    Database / Cylinder
{{}}   Subroutine / Predefined process
[()]   Stadium / Pill shape
[//]   Slanted rectangle
```

**Style blocks** are inline JSON-like:
```
node1: [Payment Service] {
    fill: "#e1f5fe",
    stroke: "#01579b",
    roughness: 1.5,
    font: "14px Caveat"
}
```

### 3.4 Edge Syntax

```
// Directed
a --> b
a -->|label| b

// Bidirectional
a <--> b

// Undirected
a --- b

// With routing hints
a -->[left] b
a -->[right, curved] b

// Dotted / dashed
a ..> b
a -..-> b

// Thick
a ==> b

// Group edges
a --> b, c, d
```

### 3.5 Groups & Containers

```
group <id> ["<label>"] [<style>] {
    <nodes_and_edges>
}

// Named boundary
boundary "Security Zone" {
    // ...
}

// Nested groups supported
```

### 3.6 Diagram-Type-Specific Syntax

#### 3.6.1 Class Diagram
```seldia
diagram flowchart "Order System" {
    Order: "Order\n+id: UUID\n+status: OrderStatus\n-items: List<OrderItem>\n+calculateTotal(): Money\n+addItem(item: OrderItem): void"
    OrderItem: "OrderItem\n+productId: UUID\n+quantity: int\n+unitPrice: Money"
    Customer: "Customer"

    Order --> OrderItem: "contains (1..*)"
    Order --> Customer: "belongs to"
}
```

*(Illustrative class layout — the parser's currently supported grammar does not
have a dedicated `class { ... }` member-body construct or edge multiplicity
labels, so this example uses a flowchart node per class with its members
folded into the label.)*

#### 3.6.2 Sequence Diagram
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

#### 3.6.3 C4 Architecture
```seldia
diagram c4 context "Internet Banking" {
    person customer: "Customer" "A bank customer"
    system banking: "Internet Banking" "Allows customers to manage accounts"
    system_Ext mainframe: "Mainframe Banking" "Core banking system"

    customer --> banking: "Views accounts, makes payments"
    banking --> mainframe: "Uses"
}
```

```seldia
diagram c4 container "Internet Banking" {
    container spa: "SPA" "React" "Client-side application"
    container api: "API" "Go" "RESTful API"
    containerDb db: "Database" "PostgreSQL" "Stores user data"

    spa --> api: "JSON/HTTPS"
    api --> db: "SQL/TCP"
}
```

#### 3.6.4 BPMN 2.0
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

#### 3.6.5 DMN Decision Table
```seldia
diagram dmn "Loan Approval" {
    age: "Input: Applicant Age"
    income: "Input: Annual Income"
    creditScore: "Input: Credit Score"

    approve: "Rule: Approve\nage >= 18 AND income > 30000 AND creditScore > 700\n-> APPROVE"
    review: "Rule: Manual Review\nage >= 18 AND income > 30000 AND creditScore <= 700\n-> MANUAL_REVIEW"
    denyAge: "Rule: Deny (Age)\nage < 18\n-> DENY"

    age --> approve
    income --> approve
    creditScore --> approve
    age --> denyAge
}
```
*(The parser's currently supported grammar does not have a dedicated `input`
/ `rule { when / output }` decision-table construct with boolean expressions,
so this example represents inputs and rules as plain nodes/edges.)*

#### 3.6.6 Chart
```seldia
diagram chart bar "Monthly Sales" {
    jan: "Jan\nRevenue: 120  Costs: 80"
    feb: "Feb\nRevenue: 200  Costs: 100"
    mar: "Mar\nRevenue: 150  Costs: 90"
    apr: "Apr\nRevenue: 180  Costs: 95"
    may: "May\nRevenue: 220  Costs: 110"
    jun: "Jun\nRevenue: 250  Costs: 120"

    jan --> feb
    feb --> mar
    mar --> apr
    apr --> may
    may --> jun
}
```
*(The parser's currently supported grammar does not have a dedicated chart
`data { categories, series }` / `options` construct, so this example
represents each category as a node carrying its series values in the label.)*

#### 3.6.7 Gantt
```seldia
diagram gantt "Project Alpha" {
    section "Planning" {
        t1: "Requirements (Jan 6 - Jan 17)"
        t2: "Architecture (Jan 13 - Jan 24)"
    }
    section "Development" {
        t3: "Sprint 1 (Jan 27 - Feb 14)"
        t4: "Sprint 2 (Feb 17 - Mar 7)"
    }
    m1: "Milestone: MVP Release (Mar 10)"

    t1 --> t2
    t2 --> t3
    t3 --> t4
    t4 --> m1
}
```
*(The parser's currently supported grammar does not have a dedicated
`task ... <date> to <date>` / `milestone ... at <date>` construct, so this
example folds the dates into the task labels.)*

#### 3.6.8 MindMap
```seldia
diagram mindmap "System Features" {
    root: "MyApp"
    frontend: "Frontend"
    backend: "Backend"
    devops: "DevOps"

    root --> frontend
    frontend --> dashboard: "Dashboard"
    frontend --> profile: "User Profile"
    frontend --> settings: "Settings"

    root --> backend
    backend --> auth: "Auth Service"
    backend --> gateway: "API Gateway"
    backend --> database: "Database"

    root --> devops
    devops --> cicd: "CI/CD"
    devops --> monitoring: "Monitoring"
    devops --> logging: "Logging"
}
```
*(The parser's currently supported grammar does not have a dedicated
indentation-based `root` / `branch` / `leaf` construct, so this example uses
plain nodes and edges to express the same tree.)*

#### 3.6.9 Form Definition
```seldia
diagram form "User Registration" {
    section "Personal Info" {
        name: "Field: name (text, required)\nplaceholder: Full name"
        email: "Field: email (email, required)"
        age: "Field: age (number, 18-120)"
    }
    section "Preferences" {
        newsletter: "Field: newsletter (checkbox)\nSubscribe to newsletter"
        theme: "Field: theme (select)\nLight | Dark | System"
    }
    submit: "Submit: Register"

    age --> submit
    theme --> submit
}
```
*(The parser's currently supported grammar does not have a dedicated `field
<id>: <type> { attrs }` / `submit` construct, so this example folds each
field's type and constraints into its node label.)*

#### 3.6.10 Sankey
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
    wind --> storage: "5"
    coal --> grid: "190"
    coal --> loss: "10"
}
```
*(The parser's currently supported grammar does not have a dedicated
`source`/`flow`/`sink` construct with string-keyed flow values, so this
example uses plain nodes and labeled edges to express the same flow graph.)*

### 3.7 Style & Theme System

#### Built-in Themes
- `sketchy-light` / `sketchy-dark` — rough hand-drawn (Rough.js primary)
- `clean-light` / `clean-dark` — smooth SVG (no Rough.js, for formal docs)
- `mono` — black & white for print

#### Custom Themes
```
theme "corporate" {
    fontFamily: "Inter, sans-serif"
    fontSize: 14
    colors {
        primary: "#2563eb"
        secondary: "#7c3aed"
        background: "#ffffff"
        text: "#1e293b"
        border: "#cbd5e1"
    }
    node {
        roughness: 0.8
        bowing: 1.2
        fillStyle: "hachure"
    }
    edge {
        roughness: 1.0
        strokeWidth: 2
    }
}
```

### 3.8 Formal Grammar (EBNF Snippet)

```ebnf
diagram        ::= "diagram" diagramType [stringLiteral] [metadata] "{" diagramBody "}"
diagramType    ::= "flowchart" | "sequence" | "class" | "er" | "state"
                 | "usecase" | "activity" | "component" | "deployment"
                 | "c4" ("context" | "container" | "component" | "code")?
                 | "bpmn" | "dmn" | "gantt" | "mindmap" | "network"
                 | "chart" ("bar" | "line" | "pie" | "radar" | "scatter" | "sankey")?
                 | "gitgraph" | "form" | "block" | "timeline"

diagramBody    ::= (themeDecl | layoutDecl | styleBlock | nodeDecl
                 |  edgeDecl | groupDecl | sectionDecl | comment)*

nodeDecl       ::= identifier ":" shapeDecl [stringLiteral] [styleBlock]
shapeDecl      ::= "(" ")" | "[" "]" | "{" "}" | "<" ">" | "[||]"
                 | "{{" "}}" | "[()]" | "[/" "/]" | "[\" "\\]"

edgeDecl       ::= nodeRef edgeOp nodeRef [edgeLabel] [edgeHints]
edgeOp         ::= "-->" | "<-->" | "---" | "..>" | "==>" | "-..->"
```

---

## 4. Architecture Overview

### 4.1 High-Level Architecture

```seldia
diagram block "SelDiA Architecture" {
    // ── Entry Points ──
    group "Entry Points" {
        block cli: "CLI (@cli)" { style: { fill: "#bbdefb" } }
        block web: "Web App (@web)" { style: { fill: "#bbdefb" } }
        block vscode: "VS Code (@vscode)" { style: { fill: "#bbdefb" } }
        block lib: "Library (@core)" { style: { fill: "#bbdefb" } }
        block api: "REST API (future)" { style: { fill: "#bbdefb" } }
    }

    // ── Plugin Layer ──
    group "Plugin Layer" {
        block fc: "Flowchart Plugin" { style: { fill: "#fff9c4" } }
        block cls: "Class Plugin" { style: { fill: "#fff9c4" } }
        block seq: "Sequence Plugin" { style: { fill: "#fff9c4" } }
        block more: "... 20+ plugins" { style: { fill: "#fff9c4" } }
    }

    // ── Core Layer ──
    group "Core Layer" {
        block parser: "Parser (Lexer + Parser)" { style: { fill: "#c8e6c9" } }
        block ast: "AST Types" { style: { fill: "#c8e6c9" } }
        block sem: "Semantic Analyzer" { style: { fill: "#c8e6c9" } }
        block pm: "Plugin Manager (Registry, Lifecycle)" { style: { fill: "#c8e6c9" } }
    }

    // ── Layout Layer ──
    group "Layout Layer" {
        block dagre: "Dagre (graphs)" { style: { fill: "#ffccbc" } }
        block elk: "ELK.js (hierarchical)" { style: { fill: "#ffccbc" } }
        block custom: "Custom Layouts" { style: { fill: "#ffccbc" } }
        block solver: "Constraint Solver (kiwi.js)" { style: { fill: "#ffccbc" } }
    }

    // ── Render Layer ──
    group "Render Layer" {
        block rough: "Rough.js Renderer" { style: { fill: "#e1bee7" } }
        block shapes: "Shapes Library" { style: { fill: "#e1bee7" } }
        block theme: "Theme Manager" { style: { fill: "#e1bee7" } }
        block export: "Export (SVG/PNG/PDF)" { style: { fill: "#e1bee7" } }
    }

    // ── Interaction Layer ──
    group "Interaction Layer" {
        block zoom: "Zoom / Pan" { style: { fill: "#b2dfdb" } }
        block sel: "Selection Manager" { style: { fill: "#b2dfdb" } }
        block dd: "Drag & Drop" { style: { fill: "#b2dfdb" } }
        block a11y: "Accessibility (ARIA)" { style: { fill: "#b2dfdb" } }
    }

    // ── Vertical dependencies ──
    cli --> fc
    web --> fc
    vscode --> fc
    fc --> parser
    cls --> ast
    parser --> dagre
    ast --> dagre
    sem --> dagre
    dagre --> rough
    elk --> shapes
    custom --> theme
    rough --> zoom
    shapes --> sel
    theme --> dd
}
```

### 4.2 Data Flow (End-to-End Pipeline)

```seldia
diagram flowchart "SelDiA Data Pipeline" {
    dsl: [DSL Text]
    lexer: [Lexer (tokens)]
    parser: [Parser (CST)]
    sem: [Semantic Analyzer (AST + Symbols)]
    transform: [Plugin-Specific Model Transform (AST → IR)]
    layout: [Layout Engine (IR → Positioned Geometry)]
    renderer: [Renderer (Geometry → SVG/Canvas)]
    interaction: [Interaction Layer (optional)]

    dsl --> lexer
    lexer --> parser
    parser --> sem
    sem --> transform
    transform --> layout
    layout --> renderer
    renderer --> interaction
}
```

### 4.3 Intermediate Representation (IR)

Between the AST and the final render, SelDiA uses a **Diagram IR** — a graph of positioned nodes and routed edges agnostic of the original diagram type.

```typescript
interface DiagramIR {
    type: DiagramType;
    title?: string;
    nodes: IRNode[];
    edges: IREdge[];
    groups: IRGroup[];
    layers: IRLayer[];
    metadata: Record<string, unknown>;
}

interface IRNode {
    id: string;
    label: string;
    shape: ShapeType;
    x: number; y: number;
    width: number; height: number;
    style: NodeStyle;
    parent?: string; // group id
    data: Record<string, unknown>; // plugin-specific data
}
```

---

## 5. Package-Level Design

### 5.1 `@seldia/core` — The Foundation

**Responsibilities:**
- DSL Lexer & Parser (generated from formal grammar via Peggy/ANTLR)
- AST node type definitions
- Semantic analysis (symbol resolution, type checking, validation)
- Plugin manager (registry, lifecycle hooks)
- Error reporting with source locations
- Configuration management

**Key Classes:**

```seldia
diagram class "CoreEngine Classes" {
    CoreEngine: "CoreEngine\n+compile(source: string): CompileResult\n+getTheme(name: string): Theme\n+getPlugin(type: string): DiagramPlugin"

    Lexer: "Lexer\n+tokenize(source: string): Token[]"

    Parser: "Parser\n+parse(tokens: Token[]): CST\n+toAST(cst: CST): DiagramAST"

    SemanticAnalyzer: "SemanticAnalyzer\n+analyze(ast: DiagramAST): AnalysisResult"
    SymbolTable: "SymbolTable\n+resolve(name: string): Symbol\n+define(symbol: Symbol): void"
    TypeChecker: "TypeChecker\n+check(node: ASTNode): TypeResult"
    ReferenceResolver: "ReferenceResolver\n+resolve(ref: Reference): ASTNode"

    PluginManager: "PluginManager\n+register(plugin: DiagramPlugin): void\n+get(type: DiagramType): DiagramPlugin"
    PluginRegistry: "PluginRegistry\n+list(): DiagramPlugin[]"
    PluginLifecycle: "PluginLifecycle\n+init(plugin: DiagramPlugin): void\n+destroy(plugin: DiagramPlugin): void"

    ConfigManager: "ConfigManager\n+load(path: string): SelDiAConfig"
    DiagnosticsCollector: "DiagnosticsCollector\n+report(diag: Diagnostic): void\n+all(): Diagnostic[]"

    CoreEngine --> Lexer: "uses"
    CoreEngine --> Parser: "uses"
    CoreEngine --> SemanticAnalyzer: "uses"
    CoreEngine --> PluginManager: "uses"
    CoreEngine --> ConfigManager: "uses"
    CoreEngine --> DiagnosticsCollector: "uses"
    SemanticAnalyzer --> SymbolTable: "has"
    SemanticAnalyzer --> TypeChecker: "has"
    SemanticAnalyzer --> ReferenceResolver: "has"
    PluginManager --> PluginRegistry: "has"
    PluginManager --> PluginLifecycle: "has"
}
```

### 5.2 `@seldia/layout` — The Layout Engine

**Responsibilities:**
- Takes Diagram IR and computes positions & dimensions
- Supports multiple layout algorithms
- Constraint-based adjustments
- Edge routing (splines, orthogonal, straight)
- Label placement

**Layout Algorithms by Diagram Type:**

| Diagram Type | Layout Algorithm |
|-------------|-----------------|
| Flowchart, Activity, BPMN | Dagre (hierarchical) |
| Class, ER, Component | Dagre / ELK.js |
| C4 (all levels) | Dagre (top-down) + container nesting |
| Sequence | Custom (lifeline-based) |
| State | Dagre / ELK (top-down) |
| Use Case | Grid + force-directed |
| Deployment | ELK.js (layered) |
| MindMap | Custom (radial tree) |
| Gantt, Timeline | Custom (time-scaled) |
| Network | Force-directed (d3-force) |
| Chart, Sankey | Custom (coordinate-based) |
| Git Graph | Custom (git-log style) |
| Form | Simple vertical flow |
| DMN | Table-based grid |
| Block | Grid / freeform |

**Key Classes:**

```seldia
diagram class "LayoutEngine Classes" {
    LayoutEngine: "LayoutEngine\n+layout(ir: DiagramIR): PositionedIR\n+setAlgorithm(algo: LayoutAlgorithm): void"

    HierarchicalLayout: "HierarchicalLayout\n+layout(ir: DiagramIR): PositionedIR"
    ForceDirectedLayout: "ForceDirectedLayout\n+layout(ir: DiagramIR): PositionedIR"
    LayeredLayout: "LayeredLayout\n+layout(ir: DiagramIR): PositionedIR"
    SequenceLayout: "SequenceLayout\n+layout(ir: DiagramIR): PositionedIR"
    RadialLayout: "RadialLayout\n+layout(ir: DiagramIR): PositionedIR"
    GridLayout: "GridLayout\n+layout(ir: DiagramIR): PositionedIR"
    TimelineLayout: "TimelineLayout\n+layout(ir: DiagramIR): PositionedIR"

    EdgeRouter: "EdgeRouter\n+route(edges: IREdge[]): RoutedEdge[]"
    SplineRouter: "SplineRouter\n+route(edges: IREdge[]): RoutedEdge[]"
    OrthogonalRouter: "OrthogonalRouter\n+route(edges: IREdge[]): RoutedEdge[]"
    StraightRouter: "StraightRouter\n+route(edges: IREdge[]): RoutedEdge[]"

    LabelPlacer: "LabelPlacer\n+place(labels: Label[]): PositionedLabel[]"

    LayoutEngine --> HierarchicalLayout: "contains"
    LayoutEngine --> ForceDirectedLayout: "contains"
    LayoutEngine --> LayeredLayout: "contains"
    LayoutEngine --> SequenceLayout: "contains"
    LayoutEngine --> RadialLayout: "contains"
    LayoutEngine --> GridLayout: "contains"
    LayoutEngine --> TimelineLayout: "contains"
    LayoutEngine --> EdgeRouter: "contains"
    LayoutEngine --> LabelPlacer: "contains"
    EdgeRouter --> SplineRouter: "variant"
    EdgeRouter --> OrthogonalRouter: "variant"
    EdgeRouter --> StraightRouter: "variant"
}
```

### 5.3 `@seldia/render` — Rough.js Renderer

**Responsibilities:**
- Converts positioned IR to visual output
- Rough.js integration for hand-drawn style
- Fallback smooth renderer for formal output
- SVG generation (primary output format)
- Canvas rendering (for interactive mode)
- PNG/PDF export
- Animation primitives (for sequence diagrams, state transitions)

**Rough.js Usage Strategy:**
- Every shape primitive goes through Rough.js with configurable `roughness`, `bowing`, `fillStyle`
- Custom shapes (database cylinder, cloud, etc.) are built from Rough.js path primitives
- Text is rendered outside Rough.js (standard SVG `<text>`), with Rough.js used for underlines/annotations
- Theme system maps to Rough.js options

**Key Classes:**

```seldia
diagram class "RenderEngine Classes" {
    RenderEngine: "RenderEngine\n+render(ir: PositionedIR): SVGString\n+setTheme(theme: Theme): void"

    RoughRenderer: "RoughRenderer\n+render(ir: PositionedIR): SVGString"
    NodeRenderer: "NodeRenderer\n+render(node: IRNode): SVGElement"
    EdgeRenderer: "EdgeRenderer\n+render(edge: IREdge): SVGElement"
    GroupRenderer: "GroupRenderer\n+render(group: IRGroup): SVGElement"
    LabelRenderer: "LabelRenderer\n+render(label: Label): SVGElement"
    IconRenderer: "IconRenderer\n+render(icon: Icon): SVGElement"

    SmoothRenderer: "SmoothRenderer\n+render(ir: PositionedIR): SVGString"

    ThemeApplicator: "ThemeApplicator\n+apply(theme: Theme, ir: PositionedIR): StyledIR"

    ShapeFactory: "ShapeFactory\n+create(type: ShapeType): Shape"
    RectangleShape: "RectangleShape"
    DiamondShape: "DiamondShape"
    CircleShape: "CircleShape"
    CylinderShape: "CylinderShape"
    HexagonShape: "HexagonShape"
    ParallelogramShape: "ParallelogramShape"
    StadiumShape: "StadiumShape"
    CloudShape: "CloudShape"
    ActorShape: "ActorShape"
    CustomPathShape: "CustomPathShape"

    SVGWriter: "SVGWriter\n+write(elements: SVGElement[]): string"
    CanvasWriter: "CanvasWriter\n+write(elements: CanvasElement[]): string"
    Exporter: "Exporter\n+export(svg: string, format: ExportFormat): Buffer"

    RenderEngine --> RoughRenderer: "contains"
    RenderEngine --> SmoothRenderer: "contains"
    RenderEngine --> ThemeApplicator: "contains"
    RenderEngine --> ShapeFactory: "contains"
    RenderEngine --> SVGWriter: "contains"
    RenderEngine --> CanvasWriter: "contains"
    RenderEngine --> Exporter: "contains"
    RoughRenderer --> NodeRenderer: "has"
    RoughRenderer --> EdgeRenderer: "has"
    RoughRenderer --> GroupRenderer: "has"
    RoughRenderer --> LabelRenderer: "has"
    RoughRenderer --> IconRenderer: "has"
    ShapeFactory --> RectangleShape: "creates"
    ShapeFactory --> DiamondShape: "creates"
    ShapeFactory --> CircleShape: "creates"
    ShapeFactory --> CylinderShape: "creates"
    ShapeFactory --> HexagonShape: "creates"
    ShapeFactory --> ParallelogramShape: "creates"
    ShapeFactory --> StadiumShape: "creates"
    ShapeFactory --> CloudShape: "creates"
    ShapeFactory --> ActorShape: "creates"
    ShapeFactory --> CustomPathShape: "creates"
}
```

### 5.4 `@seldia/interaction` — Editing Vocabulary (Types Only)

The class-per-concern design below (`InteractionManager` owning `ZoomPanHandler`,
`SelectionManager`, `DragDropHandler`, etc.) was the original plan but was never
wired up — nothing outside this package ever imported the runtime classes. The
vscode-ext webview client (§9.4) implements zoom/pan, selection and drag/drop
directly as a reducer + DOM adapter instead, and `@seldia/interaction` was
trimmed to just the shared type vocabulary (`EditMode`, `VisualEditState`,
`DslPatch`, `UndoRedoManager`, source-map types) that `vscode-ext/src/edit/`
and the webview client import. See docs/next_steps.md §3.2 step 0 for the
cleanup that removed the unused classes.

### 5.5 Diagram Plugins (`@seldia/diagrams/*`)

Each diagram type is a self-contained plugin that:

1. **Extends the grammar** with type-specific syntax rules
2. **Provides AST node types** for the type-specific constructs
3. **Transforms** AST nodes into the unified Diagram IR
4. **Selects default layout** algorithm and options
5. **Provides default styling** and shape mappings

**Plugin Interface:**
```typescript
interface DiagramPlugin {
    readonly type: DiagramType;
    readonly version: string;

    // Extend the core grammar
    grammarExtensions?: string; // PEG.js grammar fragment

    // AST node types for this diagram
    astNodeTypes: Record<string, ASTNodeConstructor>;

    // Transform plugin-specific AST → unified Diagram IR
    transform(ast: DiagramAST, config: SelDiAConfig): DiagramIR;

    // Provide default layout options
    getDefaultLayout(): LayoutOptions;

    // Provide default style
    getDefaultStyle(theme: Theme): Partial<Theme>;
}
```

### 5.6 `@seldia/cli` — Command-Line Interface

```
seldia compile input.seldia -o output.svg
seldia compile input.seldia -o output.png --scale 2
seldia compile input.seldia -o output.html --interactive
seldia serve input.seldia --port 3000     # Live preview server
seldia init diagram.seldia                # Scaffold a new diagram
seldia validate input.seldia              # Validate without rendering
```

### 5.7 `@seldia/web` — Web Component & React Wrapper

```html
<seldia-viewer diagram="flowchart" src="./diagram.seldia"></seldia-viewer>
<seldia-editor diagram="class" theme="sketchy-dark"></seldia-editor>
```

```tsx
import { SelDiAViewer, SelDiAEditor } from '@seldia/web';

<SelDiAEditor
    diagram="sequence"
    value={dslText}
    onChange={setDslText}
    theme="sketchy-dark"
/>
```

### 5.8 `@seldia/vscode-ext` — VS Code Extension

The VS Code extension provides a **Mermaid-like experience**: SelDiA diagrams are detected in Markdown documents and `.seldia` files, auto-rendered as interactive visual diagrams, and support bidirectional visual editing.

#### 5.8.1 Core User Experience

```seldia
diagram block "VS Code — Markdown + SelDiA Preview" {
    group "VS Code Window" {
        block editor: "README.md Editor" { style: { fill: "#e3f2fd" } }
        block toolbar: "🔄 Preview  [</> Code]" { style: { fill: "#e8eaf6" } }
        block preview: "Built-in Markdown Preview" { style: { fill: "#e8f5e9" } }

        group "Preview renders SelDiA inline" {
            block diagram: "📐 C4 Context Diagram (rendered SVG)\n┌──────────┐          ┌──────────┐\n│  🙋 User  │─────────▶│  💻 My App │\n└──────────┘  Uses    └──────────┘" { style: { fill: "#fff9c4" } }
            block controls: "[ Zoom: 100% ]  [ Theme ]  [ Export ]" { style: { fill: "#f3e5f5" } }
        }
    }

    editor --> preview: "Cmd+Shift+V"
    preview --> diagram: "renders"
    diagram --> controls: "toolbar"
}
```

*The `\`\`\`seldia` fenced block in the Markdown source is replaced by the rendered diagram inline within VS Code's built-in Markdown preview. No separate panel.*

**Key behaviors (mirroring Mermaid's VS Code extension):**

1. **Auto-detect** — Any ` ```seldia ` fenced code block in `.md`, `.mdx`, `.rst` files is detected
2. **Render by default** — Diagrams render as visuals inline; the DSL code is hidden behind a toggle
3. **Toggle Code/Preview** — A `</>` button in the toolbar switches between code and rendered diagram
4. **Visual Editing** — In rendered mode, double-click a shape to edit its label/style; drag nodes to reposition; right-click for context menu
5. **Live Sync** — Visual edits update the underlying DSL source; DSL edits re-render the diagram
6. **Standalone `.seldia` files** — Open with the SelDiA editor for full split-pane (code | preview)

#### 5.8.2 Markdown Integration Architecture

```seldia
diagram flowchart "Markdown → Preview Integration" {
    md: [Markdown Document\n(e.g., README.md)]
    detector: [Block Detector\nScans for ```seldia blocks]
    compile: [Core Engine\nCompile DSL → SVG]
    plugin: [Markdown-It Plugin\nReplaces fence with SVG]
    preview: [Built-in Markdown Preview\nRenders diagrams inline]
    interaction: [Preview Script\nZoom, pan, export]
    editor: [Text Editor\nDSL source remains editable]

    md --> detector: "open/save"
    detector --> compile: "extract source"
    compile --> plugin: "SVG string"
    plugin --> preview: "inject HTML"
    preview --> interaction: "attach controls"
    editor --> detector: "edit triggers rescan"
    interaction --> editor: "click 'Edit' → reveal source"
}
```

*The `extendMarkdownIt` API hooks into VS Code's built-in Markdown preview — no separate webview panel is opened for markdown files.*

**Detection of SelDiA blocks:**

The extension registers a `DocumentLinkProvider` and `CodeLensProvider` that scan for fenced code blocks with the `seldia` language identifier:

````
```seldia
diagram flowchart "..." {
    ...
}
```
````

Also supports the `seldia-` prefix for inline mode:
```
```seldia-flowchart
```
(infers diagram type from the language suffix)

Additionally, code blocks with the comment `// seldia` on the first line inside generic code blocks are detected as fallback:
```
```
// seldia flowchart "My Flow"
start --> end
```
```

#### 5.8.3 Visual Editing Mode

When a diagram is rendered in the VS Code webview, users can interact with it visually:

| Gesture | Action | DSL Effect |
|---------|--------|-----------|
| **Drag a node** | Reposition node | Adds/updates `layout: { x, y }` on the node |
| **Double-click a node** | Open inline label editor | Updates the node's label string |
| **Double-click an edge** | Open inline label editor | Updates the edge's label |
| **Right-click → Edit Style** | Open style property editor | Updates the node/edge style block |
| **Right-click → Add Node** | Insert a new connected node | Adds new `nodeDecl` + `edgeDecl` to DSL |
| **Right-click → Delete** | Remove a node/edge | Removes the corresponding DSL statement |
| **Drag edge endpoint** | Reroute edge to different node | Updates source/target ID |
| **Resize handle (corner)** | Resize a node | Updates `minWidth`/`minHeight` in style |
| **Ctrl+Z / Ctrl+Shift+Z** | Undo/Redo visual changes | Reverts to previous DSL source state |

#### 5.8.4 Visual → DSL Code Synchronization (Round-Trip)

```seldia
diagram flowchart "Visual Edit → DSL Round-Trip" {
    preview: [Rendered Diagram\n(Built-in Markdown Preview)]
    editHandler: [Edit Handler\n1. Map visual change to AST diff\n2. Generate DSL patch\n3. Apply to editor]
    editor: [VS Code TextEditor\n(DSL Source)]
    changeHandler: [Change Handler\n1. Re-parse\n2. Re-layout\n3. Push new SVG]

    preview --> editHandler: "Visual Edit\n(Drag, dbl-click, context menu)"
    editHandler --> editor: "vscode.WorkspaceEdit"
    editor --> changeHandler: "DSL edit detected"
    changeHandler --> preview: "Re-render SVG"
}
```

**Key design constraint:** Visual edits must produce **deterministic, readable DSL code** — not machine-generated gibberish. The edit handler uses:

1. **Source map** (IR node ↔ source location): Every IR node and edge carries a `sourceLocation` back to the original DSL text
2. **Template-based code generation**: When a visual edit cannot be expressed as a simple position update (e.g., adding a new node), the handler generates idiomatic DSL following the same formatting conventions as the surrounding code
3. **Diff-based patching**: Changes are applied as minimal text edits using `vscode.WorkspaceEdit`, preserving manual formatting and comments outside the affected region

#### 5.8.5 Extension Components

```
@seldia/vscode-ext/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts                    # Activation entry point
│   │
│   ├── markdown/                       # Markdown integration
│   │   ├── detector.ts                 # Scans for ```seldia blocks
│   │   ├── decorator.ts               # Inline SVG decoration provider
│   │   ├── codelens.ts                 # "View Diagram" / "Edit Code" CodeLens
│   │   └── preview-panel.ts           # Custom webview for full preview
│   │
│   ├── editor/                         # .seldia file editor
│   │   ├── seldia-editor-provider.ts   # CustomTextEditorProvider
│   │   ├── split-panel.ts             # Code | Preview split view
│   │   └── status-bar.ts              # Status bar: diagram type, theme, zoom
│   │
│   ├── webview/                        # Rendered diagram webview (host side)
│   │   ├── provider.ts                 # VS Code glue only: panel lifecycle, message wiring
│   │   ├── messenger.ts               # postMessage bridge (webview ↔ extension)
│   │   └── client/                    # Webview-side client, bundled to media/editor.js
│   │       └── editor.ts              # Interaction state machine + DOM adapter
│   │
│   ├── edit/                            # Pure editing logic (no vscode API)
│   │   ├── session.ts                 # EditSession: source + undo model + intent → TextEdit[]
│   │   └── position-patch.ts          # Patchers: label/position/attr/delete edits
│   │
│   ├── language-server/                # LSP for .seldia files
│   │   ├── server.ts                   # LSP server startup
│   │   ├── diagnostics.ts              # Error/warning diagnostics
│   │   ├── completion.ts               # Autocomplete provider
│   │   ├── hover.ts                    # Hover information
│   │   ├── definition.ts              # Go-to-definition for node refs
│   │   └── symbols.ts                 # Document symbols (outline)
│   │
│   ├── commands/                       # VS Code commands
│   │   ├── toggle-view.ts             # Toggle code ↔ diagram view
│   │   ├── export.ts                   # Export to SVG/PNG/PDF
│   │   ├── scaffold.ts                # Scaffold new diagram from template
│   │   ├── insert-diagram.ts          # Insert ```seldia block in markdown
│   │   └── theme-cycle.ts             # Cycle through built-in themes
│   │
│   ├── skill/                          # Copilot skill deployment
│   │   ├── index.ts                    # Public API: deploySkill(), checkStatus()
│   │   ├── types.ts                    # SkillDeploymentConfig, SkillManifest, SkillStatus
│   │   ├── provider.ts                 # SkillProvider implementation
│   │   ├── deployer.ts                 # File-copy deployment logic
│   │   ├── manifest.ts                 # Manifest read/write/compare
│   │   └── status-bar.ts              # Status bar integration
│   │
│   └── utils/
│       ├── source-map.ts               # AST node ↔ source location mapping
│       ├── code-generator.ts           # DSL code generation from IR changes
│       ├── diff-patcher.ts             # Minimal text edit computation
│       └── config.ts                   # Extension configuration
│
├── syntaxes/
│   ├── seldia.tmLanguage.json          # TextMate grammar for .seldia
│   └── seldia-markdown.tmLanguage.json # Injection grammar for ```seldia in .md
│
├── snippets/
│   ├── seldia.code-snippets            # Code snippets (.seldia files)
│   └── markdown.code-snippets          # Markdown snippet (```seldia block)
│
├── media/
│   ├── icon.svg                        # Extension icon
│   ├── preview-styles.css              # Styles for the webview preview
│   └── toolbar-icons/                  # Toolbar button SVGs
│
└── resources/
    └── templates/                      # Diagram scaffold templates
        ├── flowchart.seldia
        ├── sequence.seldia
        ├── c4-context.seldia
        └── ... (one per diagram type)
```

#### 5.8.6 Webview ↔ Extension Communication Protocol

The webview (rendered diagram) and the extension host communicate via VS Code's `postMessage` API:

```typescript
// Messages from Extension → Webview
type ExtToWebview =
  | { type: 'render'; ir: DiagramIR; theme: string; interactive: boolean }
  | { type: 'updateTheme'; theme: string }
  | { type: 'updateZoom'; scale: number }
  | { type: 'selectNode'; nodeId: string }
  | { type: 'highlightError'; nodeId: string; message: string };

// Messages from Webview → Extension
type WebviewToExt =
  | { type: 'ready' }
  | { type: 'nodeDragged'; nodeId: string; newPosition: { x: number; y: number } }
  | { type: 'nodeDoubleClicked'; nodeId: string }
  | { type: 'edgeDoubleClicked'; edgeId: string }
  | { type: 'labelEdited'; nodeId: string; newLabel: string }
  | { type: 'styleEdited'; nodeId: string; stylePatch: Partial<NodeStyle> }
  | { type: 'nodeAdded'; parentId?: string; position: { x: number; y: number } }
  | { type: 'nodeDeleted'; nodeId: string }
  | { type: 'edgeDeleted'; edgeId: string }
  | { type: 'edgeRerouted'; edgeId: string; newSourceId?: string; newTargetId?: string }
  | { type: 'exportRequested'; format: 'svg' | 'png' | 'pdf' }
  | { type: 'undoRequested' }
  | { type: 'redoRequested' };
```

#### 5.8.7 Context Menu Actions

When right-clicking a rendered diagram in the webview:

| Menu Item | Action |
|-----------|--------|
| **Edit Label** | Opens inline text editor on the shape |
| **Edit Style** | Opens a property panel (fill, stroke, roughness, font) |
| **Change Shape** | Dropdown to switch shape type (rectangle → diamond → rounded, etc.) |
| **Add Connected Node** | Creates a new node with an edge from the selected node |
| **Add Edge** | Starts edge-drawing mode (click source, click target) |
| **Bring to Front / Send to Back** | Adjusts z-order |
| **Delete** | Removes the element |
| **Copy as DSL** | Copies the node/edge DSL snippet to clipboard |
| **Export Diagram** | Exports the full diagram to SVG/PNG/PDF |

#### 5.8.8 Configuration (package.json contributes)

```json
{
  "contributes": {
    "configuration": {
      "title": "SelDiA",
      "properties": {
        "seldia.renderOnSave": {
          "type": "boolean",
          "default": true,
          "description": "Auto-render diagrams when saving a .seldia or .md file"
        },
        "seldia.defaultView": {
          "type": "string",
          "enum": ["diagram", "code", "split"],
          "default": "diagram",
          "description": "Default view mode for .seldia files and markdown blocks"
        },
        "seldia.defaultTheme": {
          "type": "string",
          "default": "sketchy-light",
          "description": "Default theme for rendered diagrams"
        },
        "seldia.markdown.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable SelDiA diagram detection in Markdown files"
        },
        "seldia.markdown.renderOnOpen": {
          "type": "boolean",
          "default": true,
          "description": "Auto-render diagrams when opening a Markdown file"
        },
        "seldia.markdown.maxDiagramsPerFile": {
          "type": "number",
          "default": 20,
          "description": "Maximum number of diagrams to auto-render per Markdown file"
        },
        "seldia.interactive.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable interactive editing (drag, double-click to edit)"
        },
        "seldia.interactive.undoStackSize": {
          "type": "number",
          "default": 50,
          "description": "Maximum number of undo steps for visual edits"
        },
        "seldia.export.defaultFormat": {
          "type": "string",
          "enum": ["svg", "png", "pdf"],
          "default": "svg",
          "description": "Default export format"
        },
        "seldia.copilotSkill.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable deployment of the SelDiA DSL Copilot skill"
        },
        "seldia.copilotSkill.scope": {
          "type": "string",
          "enum": ["workspace", "user", "both"],
          "default": "workspace",
          "description": "Where to deploy the SelDiA DSL Copilot skill"
        },
        "seldia.copilotSkill.autoDeploy": {
          "type": "boolean",
          "default": false,
          "description": "Auto-deploy the Copilot skill without prompting on activation"
        },
        "seldia.copilotSkill.promptBeforeDeploy": {
          "type": "boolean",
          "default": true,
          "description": "Show a prompt before first-time skill deployment"
        },
        "seldia.copilotSkill.autoUpdate": {
          "type": "boolean",
          "default": true,
          "description": "Automatically update the Copilot skill when the extension updates"
        }
      }
    },
    "commands": [
      { "command": "seldia.toggleView", "title": "SelDiA: Toggle Code / Diagram View" },
      { "command": "seldia.exportDiagram", "title": "SelDiA: Export Diagram" },
      { "command": "seldia.insertDiagram", "title": "SelDiA: Insert Diagram Block" },
      { "command": "seldia.cycleTheme", "title": "SelDiA: Cycle Theme" },
      { "command": "seldia.openPreview", "title": "SelDiA: Open Preview to the Side" },
      { "command": "seldia.exportAllDiagrams", "title": "SelDiA: Export All Diagrams in File" },
      { "command": "seldia.deploySkill", "title": "SelDiA: Deploy Copilot Skill" },
      { "command": "seldia.updateSkill", "title": "SelDiA: Update Copilot Skill" },
      { "command": "seldia.uninstallSkill", "title": "SelDiA: Uninstall Copilot Skill" },
      { "command": "seldia.checkSkillStatus", "title": "SelDiA: Check Skill Status" }
    ],
    "keybindings": [
      { "command": "seldia.toggleView", "key": "ctrl+shift+v", "when": "editorLangId == seldia || seldiaMarkdownActive" },
      { "command": "seldia.cycleTheme", "key": "ctrl+shift+t", "when": "seldiaDiagramFocused" }
    ],
    "menus": {
      "editor/context": [
        { "command": "seldia.exportDiagram", "when": "seldiaDiagramFocused", "group": "seldia" }
      ],
      "editor/title": [
        { "command": "seldia.toggleView", "when": "editorLangId == seldia || seldiaMarkdownActive", "group": "navigation" }
      ]
    }
  }
}
```

#### 5.8.9 Phased Implementation for VS Code Extension

| Phase | Weeks | Deliverable |
|-------|-------|-------------|
| **9a: Core Extension** | 19 | TextMate grammar, LSP (diagnostics + completion), basic preview panel for `.seldia` files |
| **9b: Markdown Detection** | 20 | ` ```seldia ` fenced block detection, inline SVG decorator, CodeLens provider |
| **9c: Interactive Editing** | 21 | Webview with Rough.js SVG rendering, drag-drop, double-click edit, undo/redo |
| **9d: Bidirectional Sync** | 22 | Visual edit → DSL source round-trip, code diff generator, formatting preservation |
| **9e: MD-to-PDF Export** | 23 | Markdown → PDF export with Puppeteer, embedded SelDiA diagrams |
| **9f: Copilot Skill** | 23 | Bundle & deploy `seldia-dsl` Copilot skill; manifest tracking; update detection; status bar |
| **9g: Polish** | 24 | Snippets, templates, context menus, keybindings, walkthrough, marketplace publication prep |

#### 5.8.10 Markdown → PDF Export (`md2pdf`)

The extension can export a Markdown file (`.md`, `.mdx`) containing ` ```seldia ` code blocks to a **fully rendered PDF** — SelDiA diagrams are compiled to SVG, embedded in the Markdown HTML, and rasterized via Puppeteer.

##### 5.8.10.1 Pipeline

```seldia
diagram flowchart "Markdown → PDF Export Pipeline" {
    md: [Markdown Source\n(README.md)]
    detect: [1. Detect ```seldia blocks\nvia BlockDetector]
    compile: [2. Compile each block\nDSL → @seldia/core → SVG]
    parse: [3. Parse Markdown → HTML\nvia marked]
    inject: [4. Inject compiled SVGs\ninto HTML placeholders]
    assemble: [5. Assemble full HTML\n+ print CSS, TOC, header/footer]
    puppeteer: [6. Launch Chromium\nvia Puppeteer]
    write: [7. Write PDF to disk]

    md --> detect
    detect --> compile
    compile --> parse
    parse --> inject
    inject --> assemble
    assemble --> puppeteer
    puppeteer --> write
}
```

##### 5.8.10.2 HTML Assembly (marked Custom Renderer)

The `marked` library is configured with a **custom renderer** that intercepts fenced code blocks with `language === 'seldia'`:

```seldia
diagram flowchart "marked Custom Renderer" {
    md_input: "Markdown Input\n(# Architecture + ```seldia fence with a c4-context diagram)"
    marked: "marked Custom Renderer\nintercepts lang=seldia fences"
    html_output: "HTML Output\n<h1>Architecture</h1> + rendered <div class=\"seldia-diagram\"><svg>...</svg></div>"

    md_input --> marked: "parse"
    marked --> html_output: "replace fence with <div> + SVG"
}
```

**Custom Renderer rules:**
- ` ```seldia ` blocks → render as `<div class="seldia-diagram">` containing the compiled SVG
- ` ```seldia-flowchart ` etc. → same treatment, diagram type inferred from language suffix
- Diagram title (from DSL) → used as `<figcaption>` below the diagram
- Error blocks (parse failures) → rendered as a styled error box with the error message

##### 5.8.10.3 PDF Styling & Print CSS

A dedicated print stylesheet is injected into the assembled HTML:

```css
/* Page setup */
@page {
    size: A4;
    margin: 25mm 20mm 30mm 20mm;
    @bottom-center {
        content: counter(page);
        font-family: 'Inter', sans-serif;
        font-size: 10pt;
        color: #666;
    }
}

/* Diagram containers */
.seldia-diagram {
    break-inside: avoid;
    page-break-inside: avoid;
    margin: 20px 0;
    padding: 12px;
    background: #fafaf9;
    border: 1px solid #e7e5e4;
    border-radius: 6px;
    text-align: center;
}

.seldia-diagram svg {
    max-width: 100%;
    height: auto;
}

.seldia-diagram__header {
    font-family: 'Inter', sans-serif;
    font-size: 11pt;
    font-weight: 600;
    color: #44403c;
    margin-bottom: 8px;
    text-align: left;
    border-bottom: 1px solid #e7e5e4;
    padding-bottom: 6px;
}

.seldia-diagram__caption {
    font-family: 'Inter', sans-serif;
    font-size: 9pt;
    color: #78716c;
    margin-top: 8px;
    font-style: italic;
}

/* Error box */
.seldia-diagram--error {
    background: #fef2f2;
    border-color: #fca5a5;
    color: #991b1b;
    padding: 16px;
    font-family: monospace;
    white-space: pre-wrap;
}

/* Table of Contents */
.seldia-toc {
    break-after: page;
    page-break-after: always;
}

/* Code blocks (non-seldia) — keep monospace */
pre:not(.seldia-diagram) {
    break-inside: avoid;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9pt;
    background: #f5f5f4;
    padding: 12px;
    border-radius: 4px;
}
```

##### 5.8.10.4 Puppeteer Configuration

```typescript
interface Md2PdfOptions {
    /** Input Markdown file path */
    inputPath: string;

    /** Output PDF file path (default: same as input, .pdf extension) */
    outputPath?: string;

    /** PDF page format */
    format?: 'A4' | 'A3' | 'Letter' | 'Legal' | 'Tabloid';

    /** Page orientation */
    orientation?: 'portrait' | 'landscape';

    /** Custom CSS to inject */
    customCss?: string;

    /** Whether to generate a Table of Contents */
    generateToc?: boolean;

    /** Whether to show page numbers */
    showPageNumbers?: boolean;

    /** Header template (HTML, supports <span class="title"/>, <span class="date"/>) */
    headerTemplate?: string;

    /** Footer template */
    footerTemplate?: string;

    /** Scale factor for the PDF (1 = 100%) */
    scale?: number;

    /** Whether to print backgrounds */
    printBackground?: boolean;

    /** Margins */
    margin?: {
        top?: string;
        right?: string;
        bottom?: string;
        left?: string;
    };

    /** Theme for SelDiA diagram rendering */
    theme?: string;
}
```

##### 5.8.10.5 Error Handling & Fallbacks

| Scenario | Handling |
|----------|----------|
| **Diagram parse error** | Render an error box in place of the diagram; continue with other diagrams |
| **Puppeteer not installed** | Show a VS Code notification: "Puppeteer required. Run `npx puppeteer browsers install chrome`" |
| **Timeout (large doc)** | 60s timeout; show progress indicator in status bar |
| **Empty Markdown** | Show warning: "No content to export" |
| **No SelDiA blocks** | Still export — plain Markdown → PDF is useful (the user just wants a PDF of their doc) |
| **Network images** | Puppeteer waits for `networkidle0` before printing |
| **Very large diagrams** | Scale down to fit page width via `max-width: 100%` on SVG |

##### 5.8.10.6 CLI & Command Integration

The MD-to-PDF feature is exposed both as a VS Code command and via the CLI for CI/CD use:

**VS Code Commands:**
```
SelDiA: Export Markdown to PDF          — Export current .md file with rendered diagrams
SelDiA: Export Markdown to PDF (Custom) — Open options dialog before export
```

**CLI:**
```bash
# Export a Markdown file with SelDiA diagrams to PDF
seldia md2pdf README.md -o docs/architecture.pdf

# Options
seldia md2pdf README.md \
    --format A4 \
    --landscape \
    --theme sketchy-light \
    --toc \
    --scale 0.9

# Batch: export all .md files in a directory
seldia md2pdf docs/ --batch -o pdfs/
```

##### 5.8.10.7 File Structure for MD-to-PDF

```
@seldia/vscode-ext/src/md2pdf/
├── index.ts                     # Public API: exportMarkdownToPdf()
├── types.ts                     # Md2PdfOptions, Md2PdfResult
├── pipeline.ts                  # Orchestrates the full pipeline
├── markdown-parser.ts           # marked custom renderer setup
├── diagram-injector.ts         # Replaces ```seldia blocks with rendered SVGs
├── html-assembler.ts            # Assembles full HTML document with CSS
├── pdf-renderer.ts             # Puppeteer wrapper: HTML → PDF
├── toc-generator.ts            # Table of Contents generation
├── print-css.ts                # Default print stylesheet
├── error-handler.ts            # Diagram error fallback rendering
└── progress-reporter.ts        # VS Code progress notification integration
```

##### 5.8.10.8 Design Decisions

| Decision | Rationale |
|----------|-----------|
| **`marked` over markdown-it** | Smaller API surface, faster for this use case, custom renderer is simpler |
| **Puppeteer over Playwright** | Puppeteer is lighter for headless PDF; Playwright would add unnecessary browser matrix |
| **SVG inline (not external files)** | Avoids file path resolution issues; self-contained HTML → PDF is reliable |
| **Print CSS with `@page`** | Native PDF pagination, headers/footers, page numbering — no JS needed |
| **Table of Contents optional** | Large docs benefit; small docs are cluttered by it. User choice. |
| **Error blocks (not failure)** | A single broken diagram shouldn't block the entire document export |
| **`networkidle0` wait** | Ensures external images (e.g., linked screenshots) are loaded before print |

#### 5.8.11 Copilot Skill Deployment

When the SelDiA VS Code extension is installed, it **deploys a Copilot skill** (`seldia-dsl`) that teaches GitHub Copilot how to write SelDiA DSL code. This enables Copilot to generate, modify, and explain SelDiA diagrams directly in chat and inline completions.

##### 5.8.11.1 Motivation

SelDiA's DSL is a custom language. Without a skill, Copilot has no knowledge of its syntax, diagram types, or conventions. By bundling and deploying a skill, Copilot gains:

- **Full DSL grammar knowledge** — all 21 diagram types, node shapes, edge syntax, styling, layout directives
- **Context-appropriate suggestions** — Copilot can suggest the right diagram type for a given scenario
- **Idiomatic code generation** — diagrams follow SelDiA conventions (kebab-case IDs, descriptive labels, consistent styling)
- **Markdown integration awareness** — Copilot knows to wrap SelDiA code in ` ```seldia ` fenced blocks in `.md` files

##### 5.8.11.2 Skill Format

The skill is packaged as a `SKILL.md` file following the [Copilot Agent Skills specification](https://code.visualstudio.com/docs/copilot/customization/agent-skills):

```
packages/vscode-ext/resources/skills/seldia-dsl/
├── SKILL.md              # Main skill file (~500 lines)
│   ├── YAML frontmatter  # name, description (keyword-rich for discovery), argument-hint
│   ├── When to Use       # Trigger conditions and use-case mapping
│   ├── DSL Syntax        # Complete grammar reference with examples
│   ├── Diagram Types     # All 21 diagram types with worked examples
│   ├── Advanced Features # Styling, layout, interactivity hints
│   └── Conventions       # Naming, best practices, Markdown integration
```

**Key design attributes of the SKILL.md:**

| Attribute | Value | Rationale |
|-----------|-------|-----------|
| `name` | `seldia-dsl` | Must match folder name; lowercase alphanumeric + hyphens |
| `description` | Keyword-rich, ~800 chars | Triggers: seldia, diagram, flowchart, C4, BPMN, ERD, sequence, etc. |
| `user-invocable` | `true` | Appears as `/seldia-dsl` slash command in chat |
| `disable-model-invocation` | `false` | Copilot auto-loads the skill when it detects diagram-related requests |
| Body length | <5000 tokens | Under the progressive loading threshold for skill instructions |

##### 5.8.11.3 Deployment Mechanism

```
Extension Activation (extension.ts)
    │
    ├── 1. Check if skill is already deployed
    │       • Read ~/.copilot/skills/seldia-dsl/SKILL.md (user scope)
    │       • Read .github/skills/seldia-dsl/SKILL.md (workspace scope)
    │
    ├── 2. Compare version & content hash
    │       • Is the deployed skill outdated? (older extension version)
    │       • Has the user modified it? (hash mismatch)
    │
    ├── 3. Decide action based on config
    │       • First install → prompt user, then deploy
    │       • Update available → show "Update SelDiA DSL skill?" toast
    │       • User modified → skip, but show status bar indicator
    │       • Already up-to-date → no action
    │
    └── 4. Deploy (if needed)
            • Copy SKILL.md from extension bundle to target path(s)
            • Write manifest (.seldia-skill-manifest.json) for version tracking
            • Fire seldia:skill:deployed event
            • Show VS Code notification: "SelDiA DSL skill deployed for Copilot ✓"
```

##### 5.8.11.4 Deployment Scopes

The skill can be deployed at two scopes, controlled by the `seldia.copilotSkill.scope` setting:

| Scope | Path | Visibility | Use Case |
|-------|------|------------|----------|
| **User** | `~/.copilot/skills/seldia-dsl/` | All workspaces (personal) | Individual developers; roams with Settings Sync |
| **Workspace** | `.github/skills/seldia-dsl/` | This project only (team) | Team-shared conventions; version-controlled in Git |

**Default behavior:**
1. If a workspace is open → prompt: *"Deploy SelDiA DSL skill to this workspace (team-shared) or your user profile (all workspaces)?"*
2. If no workspace → deploy to user scope automatically
3. If both already exist → check versions, offer update if outdated

##### 5.8.11.5 Manifest & Version Tracking

A lightweight manifest file (`.seldia-skill-manifest.json`) is written alongside the deployed SKILL.md:

```json
{
  "name": "seldia-dsl",
  "version": "1.0.0",
  "deployedBy": "seldia-vscode-ext@1.0.0",
  "deployedAt": "2025-07-13T10:30:00Z",
  "scope": "workspace",
  "skillPath": ".github/skills/seldia-dsl/SKILL.md",
  "contentHash": "sha256:abc123def456..."
}
```

This enables:
- **Update detection**: Compare extension version vs deployed version
- **User-modification detection**: Compare content hash; if mismatched, the user has customized the skill and auto-update is skipped
- **Uninstall tracking**: Clean removal of both SKILL.md and manifest

##### 5.8.11.6 VS Code Integration Points

| Integration | Description |
|-------------|-------------|
| **Status Bar** | `SelDiA Skill: Active` / `SelDiA Skill: Update Available` / `SelDiA Skill: Not Deployed` |
| **Command Palette** | `SelDiA: Deploy Copilot Skill`, `SelDiA: Update Copilot Skill`, `SelDiA: Uninstall Copilot Skill`, `SelDiA: Check Skill Status` |
| **Notification** | Toast on first activation: *"SelDiA can teach Copilot to write diagrams. Deploy DSL skill?"* [Deploy] [Not Now] |
| **Settings** | `seldia.copilotSkill.enabled`, `.scope`, `.autoDeploy`, `.promptBeforeDeploy`, `.autoUpdate` |
| **Walkthrough** | Step in the extension's walkthrough: "Enable Copilot Integration" |

##### 5.8.11.7 User Experience Flow

```seldia
diagram flowchart "Copilot Skill Deployment UX" {
    install: [Extension Installed / Activated]
    prompt: {Prompt: "Teach Copilot\nto write diagrams?"}
    deploy_ws: [Deploy to Workspace]
    deploy_user: [Deploy for All Workspaces]
    not_now: [Not Now]
    deployed: [Skill Deployed ✅]
    capabilities: [
        Copilot can now:
        • Generate diagrams from NL
        • Suggest diagram types
        • Complete DSL code inline
        • Explain & refactor diagrams
        • Convert between types
    ]

    install --> prompt
    prompt --> deploy_ws: "Workspace"
    prompt --> deploy_user: "User-wide"
    prompt --> not_now: "Dismiss"
    deploy_ws --> deployed
    deploy_user --> deployed
    deployed --> capabilities
}
```

##### 5.8.11.8 Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Skill over Instructions** | Skill is on-demand (loaded when relevant); instructions would burn context on every interaction. Skill can be invoked via `/seldia-dsl` slash command. |
| **Skill over Agent** | No need for context isolation or tool restrictions; a skill provides the same DSL knowledge without the overhead of a custom agent. |
| **Bundled in extension, not separate download** | Ensures version consistency; skill updates ship with extension updates. Zero user friction. |
| **Prompt before deploy** | Respects user choice; avoids cluttering `.github/` without consent. Power users can set `autoDeploy: true`. |
| **Manifest-based version tracking** | Simple JSON file; no dependency on VS Code's global state. Survives extension reinstall. Git-friendly (workspace scope). |
| **Content hash for modification detection** | Prevents overwriting user customizations. Users can extend the skill with org-specific conventions. |
| **Both user and workspace scopes** | Matches Copilot's own skill resolution order. Teams can version-control workspace skills; individuals can have personal skills. |

##### 5.8.11.9 File Structure

```
packages/vscode-ext/
├── resources/
│   └── skills/
│       └── seldia-dsl/
│           └── SKILL.md                    # The Copilot skill file
│
├── src/
│   └── skill/
│       ├── index.ts                        # Public API: deploySkill(), checkStatus(), etc.
│       ├── types.ts                        # SkillDeploymentConfig, SkillManifest, SkillStatus, etc.
│       ├── provider.ts                     # SkillProvider implementation
│       ├── deployer.ts                     # File-copy deployment logic
│       ├── manifest.ts                     # Manifest read/write/compare
│       └── status-bar.ts                   # Status bar integration
```

---

## 6. Plugin System

### 6.1 Plugin Lifecycle

```
Registration → Activation → Grammar Merge → Parser Rebuild
                                          ↓
                    DSL Text → Lexer/Parser → AST
                                          ↓
                    Plugin.transform(AST) → Diagram IR
                                          ↓
                    Layout → Render → Display
```

### 6.2 Plugin Discovery

Plugins are discovered via:
1. **Static imports** in the monorepo (built-in plugins)
2. **Dynamic imports** from npm packages matching `@seldia/diagram-*`
3. **Configuration** in `seldia.config.json`

### 6.3 Built-in Plugins

| Plugin Package | Diagram Types |
|---------------|--------------|
| `@seldia/diagrams/flowchart` | Flowchart, Activity |
| `@seldia/diagrams/sequence` | Sequence |
| `@seldia/diagrams/class` | Class, Object |
| `@seldia/diagrams/er` | Entity-Relationship |
| `@seldia/diagrams/state` | State, State Machine |
| `@seldia/diagrams/usecase` | Use Case |
| `@seldia/diagrams/component` | Component |
| `@seldia/diagrams/deployment` | Deployment, Network |
| `@seldia/diagrams/c4` | C4 (Context, Container, Component, Code) |
| `@seldia/diagrams/bpmn` | BPMN 2.0 |
| `@seldia/diagrams/dmn` | DMN Decision Tables |
| `@seldia/diagrams/gantt` | Gantt, Timeline, WBS |
| `@seldia/diagrams/mindmap` | MindMap |
| `@seldia/diagrams/network` | Network, Cloud Architecture |
| `@seldia/diagrams/chart` | Bar, Line, Pie, Radar, Scatter |
| `@seldia/diagrams/gitgraph` | Git Graph |
| `@seldia/diagrams/form` | Form Definition |
| `@seldia/diagrams/sankey` | Sankey |
| `@seldia/diagrams/block` | Block Diagram |
| `@seldia/diagrams/timeline` | Timeline |

---

## 7. Layout Engine

### 7.1 Strategy

The layout engine is **algorithm-first, constraint-second**:

1. A primary layout algorithm places nodes
2. A constraint solver (kiwi.js) applies manual overrides
3. An edge router finds paths avoiding node overlaps
4. A label placer finds optimal text positions

### 7.2 Constraint System

Users can add layout hints in the DSL:
```
nodeA --> nodeB { layout: { sameRow: true } }
nodeC { layout: { x: 300, y: 200 } }  // manual position
group G1 { layout: { direction: left-to-right } }
```

### 7.3 Edge Routing

```
Straight ────────────────────────   (simple flowcharts)
Spline  ╭──╮╭──╮                   (default)
        ╰──╯╰──╯
Orthogonal ┌──┐┌──┐               (BPMN, deployment)
           └──┘└──┘
Curved   ╭─────╮                   (mind maps, state)
```

### 7.4 Incremental Layout

When a user drags a node interactively:
1. Affected nodes are re-laid-out incrementally
2. Non-affected nodes keep their positions
3. Edge paths are re-routed
4. The constraint solver respects manual positions

---

## 8. Renderer — Rough.js Integration

### 8.1 Rendering Pipeline

```
Diagram IR
    │
    ▼
Z-Order Sort (by layer)
    │
    ▼
Group Bounds Calculation
    │
    ▼
Per-Node: ShapeFactory → Rough.js canvas → SVG path data
    │
    ▼
Per-Edge: EdgeRouter → Rough.js line/curve → SVG path data
    │
    ▼
Label Placement → SVG <text> elements
    │
    ▼
SVG Assembly → <svg> document
    │
    ▼
(Optional) Canvas → PNG export
```

### 8.2 Rough.js Configuration per Element

```typescript
interface RoughNodeStyle {
    roughness: number;       // 0 (smooth) to 3 (very sketchy) — default 1.2
    bowing: number;          // 0 to 5 — default 1.5
    fillStyle: 'hachure' | 'solid' | 'zigzag' | 'cross-hatch' | 'dots' | 'dashed' | 'zigzag-line';
    fillWeight: number;      // stroke width of fill pattern
    hachureAngle: number;    // angle of hachure lines
    hachureGap: number;      // gap between hachure lines
    strokeWidth: number;
    stroke: string;          // CSS color
    fill: string;            // CSS color
}
```

### 8.3 Shape Mapping

| DSL Shape | Rough.js Primitive | Notes |
|-----------|-------------------|-------|
| `[text]` | `rectangle` | Standard process box |
| `(text)` | Rounded `rectangle` or `ellipse` | Start/end or use case |
| `{text}` | `polygon` (4 points) | Diamond decision |
| `<text>` | `polygon` (6 points) | Hexagon |
| `[/text/]` | `polygon` (4 points, skewed) | Parallelogram |
| `[text]` | `rectangle` + double vertical lines | Database cylinder (custom path) |
| `{{text}}` | `rectangle` + vertical side-stripes | Subroutine |
| `[()]` | `rectangle` (max rounded) | Stadium/pill |
| Actor | Custom lines + `circle` | Stick figure |

### 8.4 Export Pipeline

```
SVG Output (primary)
    ├── Inline CSS styles
    ├── Embedded fonts via @import
    └── Responsive viewBox

PNG Output
    └── SVG → offscreen Canvas → toDataURL() / toBlob()

PDF Output
    └── SVG → jsPDF / pdfkit

Interactive HTML
    └── SVG + Interaction Layer JS bundle
```

---

## 9. Interaction Layer

### 9.1 Feature Matrix

| Feature | SVG Mode | Canvas Mode |
|---------|----------|-------------|
| Zoom (scroll) | ✅ CSS transform | ✅ Canvas transform |
| Pan (drag) | ✅ CSS transform | ✅ Canvas transform |
| Click select | ✅ DOM events | ✅ Hit testing |
| Drag nodes | ✅ DOM events | ✅ Hit testing |
| Hover tooltip | ✅ CSS :hover | ✅ Hit testing |
| Expand/collapse | ✅ DOM mutation | ✅ Re-render |
| Keyboard nav | ✅ tabindex | ✅ Custom |
| ARIA | ✅ native | ⚠️ Manual |
| Inline label edit | ✅ contentEditable | ✅ Overlay input |
| Resize handles | ✅ DOM manipulation | ✅ Canvas overlay |
| Edge rerouting | ✅ Drag endpoint | ✅ Drag endpoint |
| Marquee selection | ✅ DOM rect | ✅ Canvas rect |

### 9.2 Hit Testing Strategy

- **SVG**: Each node/edge is a DOM element; native events.
- **Canvas**: Quadtree-based spatial index for O(log n) hit testing.

### 9.3 Accessibility

- All nodes rendered with `<title>` and `<desc>` elements
- Groups have `role="group"` with `aria-label`
- Interactive elements are keyboard-focusable
- Live regions announce selection changes
- High-contrast theme option

### 9.4 Visual Edit Mode

The interaction layer supports a **visual edit mode** that enables direct manipulation of rendered diagrams. This mode is used by the VS Code extension webview and the web playground.

#### 9.4.1 Edit Operations

```seldia
diagram block "Visual Edit Operations" {
    group "Drag & Drop" {
        card drag_move: "Move node"
        card drag_resize: "Resize"
        card drag_reroute: "Reroute edge"
        card drag_reorder: "Reorder z-index"
    }

    group "Inline Edit" {
        card inline_label: "Edit label"
        card inline_style: "Edit style properties"
        card inline_shape: "Change shape type"
    }

    group "Structural Edit" {
        card struct_add: "Add node"
        card struct_del: "Delete node"
        card struct_edge: "Add/remove edge"
        card struct_group: "Group/ungroup"
    }
}
```

#### 9.4.2 Edit Pipeline (Visual → IR → DSL)

```seldia
diagram flowchart "Visual Edit Pipeline" {
    gesture: [Visual Gesture\n(drag, dbl-click, right-click)]
    recognizer: [Gesture Recognizer\nMaps DOM events to edit intents]
    editMgr: [Edit Manager\nValidates edit, computes affected elements]
    irMutator: [IR Mutator\nApplies change to in-memory Diagram IR]
    incLayout: [Incremental Layout\nRe-lays out only affected elements]
    incRender: [Incremental Render\nRe-renders only changed SVG]
    sourceMap: [Source Map → DSL\nPatch Generator]
    dslPatch: [DSL Source Edit\n(Minimal text edit via WorkspaceEdit)]

    gesture --> recognizer
    recognizer --> editMgr
    editMgr --> irMutator
    irMutator --> incLayout
    incLayout --> incRender
    incRender --> sourceMap
    sourceMap --> dslPatch
}
```

#### 9.4.3 Interaction State Machine

```seldia
diagram state "Diagram Interaction States" {
    [*] --> Idle
    Idle --> Selected: "click node"
    Selected --> Dragging: "drag start"
    Dragging --> Idle: "drag end"
    Selected --> Editing: "dblClick"
    Editing --> Idle: "Enter / Esc"

    Idle --> Idle: "Esc from any state → Idle"
    Selected --> Selected: "Right-click → Context Menu (always available)"
}
```
*(The parser's currently supported grammar does not have a dedicated `note
right of <state>: "..."` annotation construct, so this example folds the two
notes into self-transitions with the same text as the edge label.)*

#### 9.4.4 Inline Property Editor

Double-clicking a node opens an inline property editor overlay:

```seldia
diagram form "Node Property Editor" {
    section "Edit Node" {
        label: "Field: label (text)\nplaceholder: Payment Service"
        shape: "Field: shape (select)\nRectangle | Diamond | Circle | Cylinder | Hexagon | Stadium | Cloud"
        fill: "Field: fill (color)\ndefault: #e1f5fe"
        stroke: "Field: stroke (color)\ndefault: #01579b"
        roughness: "Field: roughness (range 0-5)\ndefault: 1.2"
        fontSize: "Field: fontSize (number 8-48)\ndefault: 14"
    }
    apply: "Submit: Apply"
    cancel: "Submit: Cancel"

    fontSize --> apply
    fontSize --> cancel
}
```
*(The parser's currently supported grammar does not have a dedicated `field
<id>: <type> { attrs }` / `submit` construct, so this example folds each
field's type and constraints into its node label — see also §3.6.9.)*

The property editor is a lightweight HTML form rendered as an overlay on the SVG/Canvas. It reads the current IR node properties and writes changes back through the edit pipeline.

#### 9.4.5 Edge Drawing Mode

In the VS Code webview, users can enter "Add Edge" mode:
1. Click the **+ Edge** toolbar button (or right-click → Add Edge)
2. Click the source node (it highlights)
3. Move the mouse — a temporary edge follows the cursor
4. Click the target node to complete the edge
5. An inline label editor appears for the edge label
6. Press Enter to confirm, Esc to cancel

```
Source Node ─ ─ ╭──╮ ─ ─ ▶ Target Node
  (click)       ╰──╯          (click)
```

#### 9.4.6 Visual Edit Keybindings

| Key | Context | Action |
|-----|---------|--------|
| `Delete` / `Backspace` | Node/Edge selected | Delete element |
| `Enter` | Node selected | Edit label |
| `F2` | Node selected | Edit label (standard rename key) |
| `Ctrl+D` | Node selected | Duplicate node |
| `Ctrl+Shift+A` | Canvas | Add new node at cursor position |
| `Ctrl+Z` | Any | Undo last visual edit |
| `Ctrl+Shift+Z` | Any | Redo |
| `Escape` | Any | Cancel current operation / deselect |
| `Arrow keys` | Node selected | Nudge position by 1px (10px with Shift) |
| `Tab` | Node selected | Select next node |
| `Ctrl+G` | Nodes selected | Group selected nodes |
| `Ctrl+Shift+G` | Group selected | Ungroup |

---

## 10. CLI, Web & VS Code Extension

### 10.1 CLI (`@seldia/cli`)

Built with **commander.js** or **yargs**:
- `seldia compile <file>` — compile to SVG/PNG/PDF/HTML
- `seldia serve <file>` — start live preview server with hot reload
- `seldia validate <file>` — validate DSL without rendering
- `seldia init` — scaffold a new `.seldia` file
- `seldia theme list|show|create` — theme management

### 10.2 Web App (`@seldia/web`)

- **Editor**: CodeMirror 6 with SelDiA language mode
- **Preview**: Split-pane with live rendering
- **Toolbar**: Diagram type selector, theme switcher, export buttons
- **Share**: URL-encode diagram for sharing (lz-string compressed)

### 10.3 VS Code Extension (`@seldia/vscode-ext`)

- Language Server Protocol (LSP) for `.seldia` files
- Syntax highlighting (TextMate grammar)
- Live preview in side-by-side or dedicated panel
- Command palette integration
- Snippets library

---

## 11. Folder Structure

```
SelDiA/
├── README.md
├── LICENSE
├── package.json                     # Root workspace (npm workspaces / turborepo)
├── tsconfig.base.json               # Shared TypeScript config
├── turbo.json                       # Turborepo pipeline config
├── .eslintrc.js
├── .prettierrc
├── .gitignore
│
├── docs/                            # Documentation
│   ├── arch.md                      # Architecture & design document (this file)
│   ├── market.md                    # Competitive position vs. Mermaid/PlantUML/D2
│   ├── next_steps.md                # Current roadmap & open technical debt
│   ├── user_guide.md                # User guide with DSL reference
│   │   ├── dsl-reference.md
│   │   ├── diagram-types/
│   │   │   ├── flowchart.md
│   │   │   ├── sequence.md
│   │   │   ├── class.md
│   │   │   └── ... (one per diagram type)
│   │   ├── themes.md
│   │   └── layout.md
│   └── api/
│       ├── core.md
│       ├── plugin-development.md
│       └── cli.md
│
├── examples/                        # Example .seldia files
│   ├── flowchart/
│   │   └── login-flow.seldia
│   ├── sequence/
│   │   └── oauth-flow.seldia
│   ├── c4/
│   │   ├── context.seldia
│   │   └── container.seldia
│   ├── bpmn/
│   │   └── order-fulfillment.seldia
│   ├── chart/
│   │   └── monthly-sales.seldia
│   └── ... (more examples)
│
├── tests/                           # Integration & E2E tests
│   ├── fixtures/
│   │   ├── valid/                   # Valid .seldia files
│   │   └── invalid/                 # Invalid .seldia files (error cases)
│   ├── integration/
│   │   ├── parser.test.ts
│   │   ├── layout.test.ts
│   │   └── render.test.ts
│   └── snapshots/                   # SVG snapshot files
│
├── packages/
│   ├── core/                        # @seldia/core
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts             # Public API entry
│   │   │   ├── engine.ts            # CoreEngine: orchestrates the pipeline
│   │   │   ├── config.ts            # SelDiAConfig, config loader
│   │   │   ├── diagnostics.ts       # Error/warning collection & reporting
│   │   │   ├── parser/
│   │   │   │   ├── index.ts
│   │   │   │   ├── lexer.ts         # Tokenizer
│   │   │   │   ├── parser.ts        # Parser (generated or hand-written)
│   │   │   │   ├── grammar.peg      # PEG grammar definition
│   │   │   │   └── tokens.ts        # Token type definitions
│   │   │   ├── ast/
│   │   │   │   ├── index.ts
│   │   │   │   ├── nodes.ts         # All AST node type definitions
│   │   │   │   ├── visitor.ts       # AST visitor pattern
│   │   │   │   └── builder.ts       # AST builder utilities
│   │   │   ├── semantic/
│   │   │   │   ├── index.ts
│   │   │   │   ├── analyzer.ts      # Semantic analysis pass
│   │   │   │   ├── symbol-table.ts  # Symbol table
│   │   │   │   ├── resolver.ts      # Reference resolution
│   │   │   │   └── validator.ts     # Diagram-specific validation rules
│   │   │   ├── plugin/
│   │   │   │   ├── index.ts
│   │   │   │   ├── manager.ts       # PluginManager
│   │   │   │   ├── registry.ts      # PluginRegistry
│   │   │   │   ├── types.ts         # DiagramPlugin interface
│   │   │   │   └── lifecycle.ts     # Plugin lifecycle hooks
│   │   │   ├── ir/
│   │   │   │   ├── index.ts
│   │   │   │   └── types.ts         # DiagramIR, IRNode, IREdge, etc.
│   │   │   ├── types/
│   │   │   │   ├── index.ts
│   │   │   │   ├── common.ts        # Point, Rect, Color, etc.
│   │   │   │   ├── style.ts         # Style, Theme, NodeStyle, EdgeStyle
│   │   │   │   └── shapes.ts        # ShapeType enum, shape definitions
│   │   │   └── utils/
│   │   │       ├── index.ts
│   │   │       ├── id-generator.ts  # Unique ID generation
│   │   │       ├── geometry.ts      # Geometric helpers
│   │   │       ├── color.ts         # Color manipulation
│   │   │       └── text-metrics.ts  # Text measurement utilities
│   │   └── __tests__/
│   │       ├── parser.test.ts
│   │       ├── ast.test.ts
│   │       └── semantic.test.ts
│   │
│   ├── layout/                      # @seldia/layout
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── engine.ts            # LayoutEngine facade
│   │   │   ├── types.ts             # LayoutOptions, LayoutResult
│   │   │   ├── algorithms/
│   │   │   │   ├── index.ts
│   │   │   │   ├── hierarchical.ts  # Dagre-based hierarchical layout
│   │   │   │   ├── force-directed.ts # d3-force-based
│   │   │   │   ├── layered.ts       # ELK.js-based layered layout
│   │   │   │   ├── sequence.ts      # Sequence diagram layout
│   │   │   │   ├── radial.ts        # Radial tree layout (mindmap)
│   │   │   │   ├── grid.ts          # Grid layout
│   │   │   │   ├── timeline.ts      # Time-scaled layout (gantt/timeline)
│   │   │   │   └── table.ts         # Table/grid layout (dmn)
│   │   │   ├── routing/
│   │   │   │   ├── index.ts
│   │   │   │   ├── router.ts        # EdgeRouter interface
│   │   │   │   ├── spline.ts        # Spline edge routing
│   │   │   │   ├── orthogonal.ts    # Orthogonal edge routing
│   │   │   │   └── straight.ts      # Straight line routing
│   │   │   ├── constraints/
│   │   │   │   ├── index.ts
│   │   │   │   ├── solver.ts        # kiwi.js constraint solver wrapper
│   │   │   │   └── constraints.ts   # Predefined constraints
│   │   │   └── label-placement/
│   │   │       ├── index.ts
│   │   │       └── placer.ts        # Label position optimizer
│   │   └── __tests__/
│   │
│   ├── render/                      # @seldia/render
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── engine.ts            # RenderEngine facade
│   │   │   ├── types.ts             # RenderOptions, RenderResult
│   │   │   ├── rough/
│   │   │   │   ├── index.ts
│   │   │   │   ├── renderer.ts      # RoughRenderer main class
│   │   │   │   ├── node-renderer.ts # Renders IRNode → Rough.js shapes
│   │   │   │   ├── edge-renderer.ts # Renders IREdge → Rough.js lines
│   │   │   │   ├── group-renderer.ts# Renders IRGroup containers
│   │   │   │   └── label-renderer.ts# Renders text labels
│   │   │   ├── smooth/               # Alternative smooth (non-Rough) renderer
│   │   │   │   ├── index.ts
│   │   │   │   └── renderer.ts
│   │   │   ├── shapes/
│   │   │   │   ├── index.ts
│   │   │   │   ├── factory.ts        # ShapeFactory
│   │   │   │   ├── base.ts           # BaseShape abstract class
│   │   │   │   ├── rectangle.ts
│   │   │   │   ├── diamond.ts
│   │   │   │   ├── circle.ts
│   │   │   │   ├── cylinder.ts       # Database cylinder (composite)
│   │   │   │   ├── hexagon.ts
│   │   │   │   ├── parallelogram.ts
│   │   │   │   ├── stadium.ts
│   │   │   │   ├── cloud.ts
│   │   │   │   ├── actor.ts          # Stick figure actor
│   │   │   │   └── icon.ts           # Icon rendering (predefined SVGs)
│   │   │   ├── theme/
│   │   │   │   ├── index.ts
│   │   │   │   ├── manager.ts        # ThemeManager
│   │   │   │   ├── resolver.ts       # Theme variable resolution
│   │   │   │   └── builtin/
│   │   │   │       ├── sketchy-light.ts
│   │   │   │       ├── sketchy-dark.ts
│   │   │   │       ├── clean-light.ts
│   │   │   │       ├── clean-dark.ts
│   │   │   │       └── mono.ts
│   │   │   ├── svg/
│   │   │   │   ├── index.ts
│   │   │   │   ├── writer.ts         # SVG document builder
│   │   │   │   └── defs.ts           # SVG <defs> (gradients, markers, filters)
│   │   │   ├── canvas/
│   │   │   │   ├── index.ts
│   │   │   │   └── writer.ts         # Canvas 2D rendering
│   │   │   └── export/
│   │   │       ├── index.ts
│   │   │       ├── png.ts            # SVG → PNG conversion
│   │   │       ├── pdf.ts            # SVG → PDF conversion
│   │   │       └── html.ts           # Interactive HTML bundler
│   │   └── __tests__/
│   │
│   ├── interaction/                  # @seldia/interaction
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── manager.ts            # InteractionManager
│   │   │   ├── zoom-pan.ts           # Zoom and pan handler
│   │   │   ├── selection.ts          # Selection manager
│   │   │   ├── drag-drop.ts          # Drag & drop handler
│   │   │   ├── expand-collapse.ts    # Group expand/collapse
│   │   │   ├── tooltip.ts            # Tooltip manager
│   │   │   ├── keyboard.ts           # Keyboard navigation
│   │   │   ├── accessibility.ts      # ARIA annotation generator
│   │   │   └── hit-testing.ts        # Spatial index for hit testing
│   │   └── __tests__/
│   │
│   ├── diagrams/                     # Diagram type plugins
│   │   ├── flowchart/
│   │   │   ├── package.json
│   │   │   ├── tsconfig.json
│   │   │   └── src/
│   │   │       ├── index.ts          # Plugin entry point
│   │   │       ├── types.ts          # Flowchart-specific types
│   │   │       ├── transformer.ts    # AST → IR transformation
│   │   │       ├── grammar.ts        # Grammar extensions
│   │   │       └── defaults.ts       # Default styles, layout options
│   │   │
│   │   ├── sequence/                 # (same structure)
│   │   ├── class/
│   │   ├── er/
│   │   ├── state/
│   │   ├── usecase/
│   │   ├── activity/
│   │   ├── component/
│   │   ├── deployment/
│   │   ├── c4/
│   │   │   └── src/
│   │   │       ├── index.ts
│   │   │       ├── context.ts        # C4 Context level
│   │   │       ├── container.ts      # C4 Container level
│   │   │       ├── component.ts      # C4 Component level
│   │   │       └── code.ts           # C4 Code level
│   │   ├── bpmn/
│   │   ├── dmn/
│   │   ├── gantt/
│   │   ├── mindmap/
│   │   ├── network/
│   │   ├── chart/
│   │   │   └── src/
│   │   │       ├── index.ts
│   │   │       ├── bar.ts
│   │   │       ├── line.ts
│   │   │       ├── pie.ts
│   │   │       ├── radar.ts
│   │   │       └── scatter.ts
│   │   ├── gitgraph/
│   │   ├── form/
│   │   ├── sankey/
│   │   ├── block/
│   │   └── timeline/
│   │
│   ├── cli/                          # @seldia/cli
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── bin/
│   │   │   └── seldia                # CLI entry point
│   │   └── src/
│   │       ├── index.ts
│   │       ├── commands/
│   │       │   ├── compile.ts
│   │       │   ├── serve.ts
│   │       │   ├── validate.ts
│   │       │   ├── init.ts
│   │       │   └── theme.ts
│   │       └── utils/
│   │           ├── file-utils.ts
│   │           └── logger.ts
│   │
│   ├── web/                          # @seldia/web
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── components/
│   │   │   │   ├── seldia-viewer.ts  # Web Component <seldia-viewer>
│   │   │   │   ├── seldia-editor.ts  # Web Component <seldia-editor>
│   │   │   │   └── seldia-live.ts    # Web Component <seldia-live> (editor+preview)
│   │   │   ├── react/
│   │   │   │   ├── index.ts
│   │   │   │   ├── SelDiAViewer.tsx
│   │   │   │   └── SelDiAEditor.tsx
│   │   │   ├── editor/
│   │   │   │   ├── codemirror-setup.ts  # CodeMirror 6 with SelDiA language
│   │   │   │   └── autocomplete.ts
│   │   │   └── playground/
│   │   │       ├── index.html
│   │   │       ├── app.ts
│   │   │       └── styles.css
│   │   └── public/
│   │       └── fonts/
│   │
│   └── vscode-ext/                   # @seldia/vscode-ext
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── extension.ts          # VS Code extension entry
│       │   ├── language-server/
│       │   │   ├── server.ts         # LSP server
│       │   │   ├── diagnostics.ts    # Diagnostic provider
│       │   │   ├── completion.ts     # Completion provider
│       │   │   └── hover.ts          # Hover provider
│       │   ├── preview/
│       │   │   ├── panel.ts          # Webview panel for preview
│       │   │   └── serializer.ts
│       │   └── commands/
│       │       ├── export.ts
│       │       └── scaffold.ts
│       ├── syntaxes/
│       │   └── seldia.tmLanguage.json   # TextMate grammar
│       └── snippets/
│           └── seldia.json              # Code snippets
│
└── scripts/                          # Build & dev scripts
    ├── build-all.sh
    ├── clean.sh
    └── generate-grammar.sh
```

---

## 12. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Language** | TypeScript 5.x (strict) → compiles to JS | Type safety, excellent tooling, web-native |
| **Runtime** | Node.js 22 LTS (via nvm) / Browser | Latest LTS, `nvm` for version management |
| **Package Manager** | npm 10.x (bundled with Node 22) | No extra tooling needed |
| **Monorepo** | Turborepo + npm workspaces | Fast, incremental builds |
| **Parsing** | Peggy (PEG.js successor) | Expressive grammar, good error messages, no build-step grammar conflicts |
| **Rendering** | Rough.js 4.x | Hand-drawn SVG/Canvas primitives |
| **Layout** | Dagre, ELK.js, d3-force, kiwi.js | Battle-tested graph layout libraries |
| **CLI Framework** | Commander.js | Mature, lightweight CLI framework |
| **Web Components** | Lit (lit-html/lit-element) | Lightweight, framework-agnostic |
| **React Wrapper** | React 18+ (optional peer dep) | For React ecosystem integration |
| **Code Editor** | CodeMirror 6 | Extensible, performant editor |
| **VS Code API** | VS Code LSP + Webview API | Native VS Code integration |
| **Markdown → PDF** | marked + Puppeteer | Markdown parsing + headless Chromium PDF |
| **Testing** | Vitest | Fast, modern, good TS support |
| **Linting** | ESLint + Prettier | Code quality consistency |
| **Build** | tsup / esbuild | Fast TypeScript bundling |
| **Doc Site** | VitePress | Markdown-based, fast, Vue-powered |

---

## 13. Key Design Decisions & Rationale

### 13.1 Why a Custom DSL Instead of Extending Existing Ones?

| Factor | Decision |
|--------|----------|
| **Consistency** | Existing tools use vastly different syntaxes. SelDiA provides ONE unified grammar. |
| **Extensibility** | Plugin-based architecture means new diagram types extend the grammar cleanly. |
| **Expressiveness** | Designed from scratch to cover all target diagram types without legacy baggage. |
| **Tooling** | A custom DSL enables first-class LSP, autocomplete, and error messages. |

### 13.2 Why Rough.js?

- **Differentiation**: The hand-drawn aesthetic is unique in the Diagram-as-Code space (only Excalidraw approaches it, but is not text-based).
- **Configurability**: Roughness is a slider — diagrams can be polished or sketchy.
- **Maturity**: Rough.js is well-maintained, pure JS, no dependencies.
- **Output quality**: SVG paths are clean and scalable.

### 13.3 Why TypeScript?

- **Type safety**: A large system with 20+ diagram types needs strong typing.
- **Web-native**: Runs in browser (playground, VS Code webview) and Node.js (CLI).
- **Ecosystem**: Rich library support (Dagre, d3, CodeMirror, etc.).
- **LSP integration**: TypeScript is the natural choice for VS Code extensions.

### 13.4 Why a Plugin Architecture?

- **Core stays lean**: The core package is ~200KB; diagram types are loaded on demand.
- **Community extensibility**: Third parties can publish `@seldia/diagram-custom` packages.
- **Independent testing**: Each plugin can be tested in isolation.
- **Gradual implementation**: Ship core + flowchart first, add plugins incrementally.

### 13.5 Why SVG as Primary Output?

- **Scalability**: Vector output at any resolution.
- **Accessibility**: DOM-based, screen-reader compatible.
- **Styleability**: CSS can be applied post-render.
- **Interactivity**: Native DOM events for web use.
- **Convertible**: SVG → PNG/PDF is straightforward.

### 13.6 Why Two Renderers (Rough + Smooth)?

- **Rough.js** is the signature style (default).
- **Smooth** renderer supports use cases where sketchy style is inappropriate (formal docs, accessibility requirements, printing).
- Both use the same ShapeFactory interface — just different implementations.

### 13.7 IR-Based Pipeline

Separating the Diagram IR from both AST and Rendering:
- **Layout engines** operate on IR only (no diagram-type knowledge needed).
- **Renderers** operate on IR only (no parsing knowledge needed).
- **New diagram types** only need an AST→IR transformer.
- **Testing** can inject IR directly without parsing DSL.

---

## 14. Implementation Plan

### Phase 0: Foundation (Weeks 1-2)

**Prerequisites:**
- Node.js 22 LTS installed via `nvm` (`nvm install 22 && nvm use 22`)
- npm 10.x (bundled with Node 22)

**Tasks:**
- [ ] Set up monorepo (Turborepo, npm workspaces, tsconfig)
- [ ] CI/CD pipeline (GitHub Actions: lint, test, build)
- [ ] `@seldia/core`: AST types, IR types, common types
- [ ] `@seldia/core`: Plugin manager interface and registry
- [ ] `@seldia/core`: Diagnostics/error framework
- [ ] `@seldia/core`: PEG.js grammar for the unified DSL (all diagram types)
- [ ] `@seldia/core`: Lexer + Parser (generated from grammar)
- [ ] `@seldia/core`: AST visitor pattern
- [ ] `@seldia/core`: Semantic analyzer (symbol table, reference resolver)

### Phase 1: Core Rendering Pipeline (Weeks 3-4)
- [ ] `@seldia/render`: Rough.js integration, ShapeFactory
- [ ] `@seldia/render`: All shape implementations (rectangle, diamond, etc.)
- [ ] `@seldia/render`: SVG writer
- [ ] `@seldia/render`: Theme manager + 5 built-in themes
- [ ] `@seldia/render`: Smooth renderer
- [ ] `@seldia/render`: Edge renderer (straight, spline, orthogonal)
- [ ] `@seldia/render`: Label renderer
- [ ] `@seldia/render`: PNG export
- [ ] `@seldia/layout`: Layout engine facade
- [ ] `@seldia/layout`: Hierarchical layout (Dagre)

### Phase 2: First Diagram Types (Weeks 5-6)
- [ ] `@seldia/diagrams/flowchart`: Full implementation
- [ ] `@seldia/diagrams/sequence`: Full implementation
- [ ] `@seldia/diagrams/class`: Full implementation
- [ ] End-to-end pipeline test: DSL → AST → IR → Layout → Render → SVG

### Phase 3: CLI & Tooling (Weeks 7-8)
- [ ] `@seldia/cli`: `compile`, `validate`, `init`, `serve` commands
- [ ] `@seldia/cli`: File watcher with hot reload for `serve`
- [ ] `@seldia/web`: Web Components (`<seldia-viewer>`, `<seldia-editor>`)
- [ ] `@seldia/web`: CodeMirror 6 language mode
- [ ] `@seldia/web`: Live playground (editor + preview split)

### Phase 4: Architecture Diagrams (Weeks 9-10)
- [ ] `@seldia/diagrams/c4`: Context, Container, Component, Code levels
- [ ] `@seldia/diagrams/component`: Component diagram
- [ ] `@seldia/diagrams/deployment`: Deployment diagram
- [ ] `@seldia/diagrams/network`: Network diagram
- [ ] `@seldia/layout`: Layered layout (ELK.js) for deployment/network

### Phase 5: Process & Behavior Diagrams (Weeks 11-12)
- [ ] `@seldia/diagrams/state`: State diagram
- [ ] `@seldia/diagrams/activity`: Activity diagram
- [ ] `@seldia/diagrams/usecase`: Use case diagram
- [ ] `@seldia/diagrams/bpmn`: BPMN 2.0 subset
- [ ] `@seldia/diagrams/dmn`: DMN decision tables

### Phase 6: Data & Visualization (Weeks 13-14)
- [ ] `@seldia/diagrams/er`: Entity-Relationship diagram
- [ ] `@seldia/diagrams/chart`: Bar, Line, Pie (Rough.js styled charts)
- [ ] `@seldia/diagrams/sankey`: Sankey diagram
- [ ] `@seldia/diagrams/chart`: Radar, Scatter

### Phase 7: Project Management & Misc (Weeks 15-16)
- [ ] `@seldia/diagrams/gantt`: Gantt chart
- [ ] `@seldia/diagrams/timeline`: Timeline
- [ ] `@seldia/diagrams/mindmap`: Mind map
- [ ] `@seldia/diagrams/gitgraph`: Git graph
- [ ] `@seldia/diagrams/form`: Form definition
- [ ] `@seldia/diagrams/block`: Block diagram

### Phase 8: Interaction & Polish (Weeks 17-18)
- [ ] `@seldia/interaction`: Zoom, pan, selection, drag-drop
- [ ] `@seldia/interaction`: Expand/collapse for groups and C4 containers
- [ ] `@seldia/interaction`: Tooltip system
- [ ] `@seldia/interaction`: Keyboard navigation
- [ ] `@seldia/interaction`: ARIA accessibility annotations

### Phase 9: VS Code Extension (Weeks 19-20)
- [ ] `@seldia/vscode-ext`: Language Server (diagnostics, completion, hover)
- [ ] `@seldia/vscode-ext`: TextMate grammar for syntax highlighting
- [ ] `@seldia/vscode-ext`: Preview panel (webview)
- [ ] `@seldia/vscode-ext`: Snippets library
- [ ] `@seldia/vscode-ext`: Export commands

### Phase 10: Documentation & Release (Weeks 21-22)
- [ ] `docs/`: Full VitePress documentation site
- [ ] `docs/`: DSL reference with examples for all diagram types
- [ ] `docs/`: Plugin development guide
- [ ] `examples/`: Curated set of example diagrams
- [ ] Public npm release of all packages
- [ ] VS Code Marketplace publication

---

## 15. Security, Performance & Accessibility

### 15.1 Security

| Concern | Mitigation |
|---------|-----------|
| **DSL injection** | Parser is read-only; no `eval()` used; all code paths are sandboxed |
| **XSS in web components** | All user-provided labels are text-sanitized before SVG injection |
| **File system access** | CLI uses whitelisted paths only |
| **Dependency supply chain** | Lockfiles, SBOM generation, periodic `npm audit` |
| **SVG security** | No `<script>` or `<foreignObject>` in generated SVGs |

### 15.2 Performance

| Concern | Mitigation |
|---------|-----------|
| **Large diagrams** (>1000 nodes) | Virtual rendering, spatial indexing, incremental layout |
| **Parsing speed** | PEG.js parser is O(n); target: <100ms for 1000-line DSL |
| **Layout speed** | Algorithm choice based on graph size; Web Worker for large graphs |
| **Rendering speed** | SVG string builder (not DOM manipulation); target: <200ms per render |
| **Bundle size** | Core ~150KB gzipped; plugins loaded on-demand; tree-shakeable |

### 15.3 Accessibility (WCAG 2.1 AA target)

| Requirement | Implementation |
|-------------|---------------|
| **Screen readers** | All nodes have `<title>` and `<desc>`; groups have `role` and `aria-label` |
| **Keyboard navigation** | Tab through nodes; arrow keys to navigate edges |
| **Color contrast** | All built-in themes meet 4.5:1 contrast ratio |
| **High-contrast mode** | `mono` theme + high-contrast variant |
| **Focus indicators** | Visible focus rings on interactive elements |
| **Text alternatives** | `alt` text for exported PNG; text extraction from SVG |

---

## Appendix A: Comparison with Existing Tools

| Feature | PlantUML | Mermaid | D2 | Structurizr | SelDiA |
|---------|----------|---------|----|------------|--------|
| Diagram types | 20+ | 15+ | 10+ | 4 (C4) | **20+** |
| Syntax consistency | ⚠️ varied | ✅ consistent | ✅ consistent | ✅ consistent | ✅ **unified** |
| Hand-drawn style | ❌ | ❌ | ❌ | ❌ | ✅ **Rough.js** |
| Plugin system | ❌ | ❌ | ❌ | ❌ | ✅ |
| C4 native | ⚠️ via includes | ⚠️ basic | ❌ | ✅ native | ✅ **native** |
| BPMN 2.0 | ⚠️ partial | ❌ | ❌ | ❌ | ✅ |
| DMN | ❌ | ❌ | ❌ | ❌ | ✅ |
| Charts | ❌ | ⚠️ basic | ❌ | ❌ | ✅ **Rough.js styled** |
| Forms | ❌ | ❌ | ❌ | ❌ | ✅ |
| Interactive | ❌ | ⚠️ limited | ❌ | ❌ | ✅ |
| ARIA accessible | ❌ | ❌ | ❌ | ❌ | ✅ |
| Open source | ✅ | ✅ | ✅ | ⚠️ partial | ✅ |

---

## Appendix B: DSL Grammar (Full EBNF)

See `packages/core/src/parser/grammar.peg` for the machine-readable grammar definition.

---

*Document Version: 1.0 — Last Updated: 2026-07-13*
