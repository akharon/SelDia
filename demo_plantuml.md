# SelDiA — PlantUML Compatibility Gallery

This document demonstrates **every diagram family** that SelDiA can **import
from** and **export to** PlantUML syntax. The same visual language (shared
neutrals, per-type accents, semantic roles) applies — but these diagrams are
written in standard PlantUML instead of the SelDiA DSL, testing that the
round-trip preserves structure.

Each block is a standard ```` ```plantuml ```` fenced code block (` ```puml `
and ` ```uml ` work too). With the SelDiA extension installed, open the
Markdown preview (`Ctrl+K V`) — SelDiA hijacks these code blocks to render them
through its own engine, just as it does for `seldia` and `mermaid` blocks.

No Java, no `plantuml.jar`, no server round trip: the importer is a native
source→IR frontend, so these render offline like any other SelDiA diagram.

---

## How to read this document

**Supported PlantUML families** (11 total):

| # | Family | PlantUML spelling | Import | Export | Notes |
|---|--------|-------------------|:------:|:------:|-------|
| 1 | **Sequence** | `participant` / `->` | ✅ | ✅ | Fragments (`alt`/`loop`/`par`), activation |
| 2 | **Class** | `class` / `<\|--` | ✅ | ✅ | Members, stereotypes, multiplicities, packages |
| 3 | **ER** | `entity { }` | ✅ | ✅ | IE crow's-foot, `<<PK>>`/`<<FK>>` |
| 4 | **Use case** | `(...)` / `:Actor:` | ✅ | ✅ | System boundaries, `<<extend>>`/`<<include>>` |
| 5 | **Activity** | `:action;` | ✅ | ✅ | Modern + legacy `(*)` forms |
| 6 | **State** | `[*] -->` | ✅ | ✅ | Composite states become groups |
| 7 | **Component** | `[...]` | ✅ | ✅ | Packages, `database`/`queue` keywords |
| 8 | **Deployment** | `node` / `artifact` | ✅ | ✅ | Nested containers |
| 9 | **Mindmap** | `@startmindmap` | ✅ | ✅ | Also `@startwbs` |
| 10 | **Gantt** | `@startgantt` | ✅ | ✅ | Relative scheduling resolved |
| 11 | **Flowchart** | — | — | ✅ | Export-only (no distinct PlantUML family) |

> **What's *not* covered**: `@startjson`, `@startsalt`, `@startditaa`,
> `@startmath` and friends are valid PlantUML blocks that SelDiA does not
> import — the engine has no matching IR or renderer, so it isn't a
> PlantUML-parsing gap. Those fences **degrade to a plain code block** rather
> than showing an error box.

**A note on type detection.** Unlike Mermaid, PlantUML has no per-diagram
header keyword — `@startuml` opens all of them. SelDiA scores the body against
each family's signature and routes to the winner, which is what stops a shared
keyword (`actor`, `database`, `entity`) from hijacking the family.

---

## 1. Sequence — OAuth authorization code flow

Participants and actors, activation bars, self-calls, `alt`/`else` and `loop`
fragments, and both solid and dashed (return) messages.

```plantuml
@startuml
title OAuth 2.0 authorization code flow

actor User
participant "Browser" as B
participant "Client App" as App
participant "Auth Server" as Auth
database "Token Store" as TS

User -> B : click "Sign in"
B -> App : GET /login
activate App
App --> B : 302 to /authorize
deactivate App

B -> Auth : GET /authorize?client_id&redirect_uri
activate Auth
Auth -> Auth : validate client_id
Auth --> B : login form
User -> B : credentials
B -> Auth : POST /login

alt credentials valid
  Auth --> B : 302 with ?code=abc
  B -> App : GET /callback?code=abc
  activate App
  App -> Auth : POST /token (code, secret)
  Auth -> TS : persist refresh token
  Auth --> App : access_token + refresh_token
  App --> B : session cookie
  deactivate App
else credentials invalid
  Auth --> B : 401 retry
end

loop every 55 minutes
  App -> Auth : POST /token (refresh_token)
  Auth --> App : new access_token
end

deactivate Auth
@enduml
```

---

## 2. Class — Order domain model

Abstract classes, interfaces with generics, enums, visibility markers
(`+ - #`), `extends`/`implements`, and all four relation kinds with
multiplicities.

```plantuml
@startuml
title Order domain model

package "domain" {
  abstract class Entity {
    # id : UUID
    + equals(o : Object) : boolean
  }

  class Customer extends Entity {
    - name : String
    - email : String
    + placeOrder(items : List<Item>) : Order
  }

  class Order extends Entity {
    - placedAt : Instant
    - status : OrderStatus
    + total() : Money
    + cancel() : void
  }

  class Item {
    - sku : String
    - qty : int
    + subtotal() : Money
  }

  enum OrderStatus {
    PENDING
    PAID
    SHIPPED
    CANCELLED
  }

  interface Repository<T> {
    + findById(id : UUID) : T
    + save(entity : T) : void
  }

  class OrderRepository implements Repository {
    + findByCustomer(c : Customer) : List<Order>
  }
}

Customer "1" *-- "0..*" Order : places
Order "1" o-- "1..*" Item : contains
Order --> OrderStatus
OrderRepository ..> Order : manages
@enduml
```

> The composition diamond lands on the *owning* end: `Customer *-- Order` is
> stored `Order → Customer` in the IR so the decorated end is the target.

---

## 3. ER — Billing schema

Entities with typed attributes, `<<PK>>`/`<<FK>>` key stereotypes, the `--`
separator, and IE crow's-foot cardinalities on every relationship.

```plantuml
@startuml
title Billing schema

entity Customer {
  * id : uuid <<PK>>
  --
  email : varchar
  name : varchar
  created_at : timestamp
}

entity Subscription {
  * id : uuid <<PK>>
  --
  customer_id : uuid <<FK>>
  plan_id : uuid <<FK>>
  status : varchar
}

entity Plan {
  * id : uuid <<PK>>
  --
  name : varchar
  price_cents : int
}

entity Invoice {
  * id : uuid <<PK>>
  --
  subscription_id : uuid <<FK>>
  amount_cents : int
  issued_at : timestamp
}

Customer ||--o{ Subscription : subscribes
Plan ||--o{ Subscription : priced_by
Subscription ||--o{ Invoice : billed_as
@enduml
```

> `<<PK>>` is normalised to a bare `PK` token, which is the spelling both the
> ER renderer's key-bolding and the `sql-ddl` exporter read. PlantUML's leading
> `*` (mandatory) is dropped — the IR has no nullability field.

---

## 4. Use case — Support portal

Actors outside a `rectangle` system boundary, use cases inside it, and
`<<include>>` / `<<extend>>` relationships.

```plantuml
@startuml
left to right direction
title Support portal

actor "Customer" as C
actor "Support Agent" as A
actor "Billing System" as BS

rectangle "Support Portal" {
  (Open ticket) as UC1
  (Search knowledge base) as UC2
  (Escalate to engineer) as UC3
  (Refund order) as UC4
  (Close ticket) as UC5
}

C --> UC1
C --> UC2
A --> UC3
A --> UC5
A --> UC4
UC4 --> BS
@enduml
```

---

## 5. Activity — Release pipeline

Modern `:action;` syntax with `if/elseif/else/endif` branching, a `while` loop,
`start`/`stop`, and labelled decision arms.

```plantuml
@startuml
title Release pipeline

start
:Merge to main;
:Run unit tests;

if (tests pass?) then (yes)
  :Build artifacts;
  :Deploy to staging;
  :Run smoke tests;

  if (smoke tests pass?) then (yes)
    :Promote to production;
    :Notify #releases;
  else (no)
    :Roll back staging;
    :Page on-call;
  endif
else (no)
  :Post failure to PR;
  :Block merge;
endif

:Publish release notes;
stop
@enduml
```

---

## 6. State — Connection lifecycle

Start and end pseudostates, a **composite state** with its own inner machine,
and labelled transitions crossing the boundary.

```plantuml
@startuml
title TCP-ish connection lifecycle

[*] --> Closed

Closed --> Connecting : open()
Connecting --> Connected : ack
Connecting --> Closed : timeout

state Connected {
  [*] --> Idle
  Idle --> Sending : write()
  Sending --> Idle : flushed
  Idle --> Receiving : data
  Receiving --> Idle : consumed
}

Connected --> Closing : close()
Closing --> Closed : fin
Connected --> Failed : error
Failed --> Closed : reset
Closed --> [*]
@enduml
```

> A composite state becomes an `IRGroup`, not a node, so it cannot be an edge
> endpoint. Transitions naming the composite are redirected onto its inner
> start state and remember the original via `source`/`targetContainer`.

---

## 7. Component — Microservice topology

Bracket shorthands with `<<stereotype>>` decorations, `as` aliases,
`database`/`queue` keywords, and three `package` containers.

```plantuml
@startuml
title Microservice deployment

package "Edge" {
  [CDN]
  [Load Balancer] as LB
}

package "Services" {
  [Gateway] <<service>>
  [Accounts] <<service>>
  [Billing] <<service>>
  [Notifications] <<service>>
}

package "Data" {
  database "Accounts DB" as ADB
  database "Billing DB" as BDB
  queue "Event Bus" as BUS
}

CDN --> LB
LB --> Gateway
Gateway --> Accounts
Gateway --> Billing
Accounts --> ADB
Billing --> BDB
Billing --> BUS
BUS --> Notifications
@enduml
```

> An explicit `<<service>>` outranks the name heuristic: `Accounts` is a
> service because the author said so, not because the word looks like one.

---

## 8. Deployment — Production estate

`node`, `artifact`, `database` and `cloud` containers, nested to two levels.

```plantuml
@startuml
title Production estate

cloud "AWS us-east-1" {
  node "EKS cluster" {
    artifact "api:2.4.1" as API
    artifact "worker:2.4.1" as WORK
  }

  node "RDS" {
    database "orders-primary" as PRIM
    database "orders-replica" as REP
  }
}

node "Operator laptop" as LAP

API --> PRIM : writes
WORK --> REP : reads
PRIM --> REP : streaming replication
LAP --> API : kubectl port-forward
@enduml
```

---

## 9. Mindmap — Product surface area

`@startmindmap` with `*` depth markers. `@startwbs` parses the same way.

```plantuml
@startmindmap
* SelDiA
** Inputs
*** SelDiA DSL
*** Mermaid
*** PlantUML
** Engine
*** Parser
*** IR
*** Layout
**** Dagre
**** ELK
**** Custom
*** Renderer
** Outputs
*** SVG
*** PNG
*** Mermaid
*** PlantUML
*** SQL DDL
** Consumers
*** CLI
*** VS Code
*** MCP
@endmindmap
```

---

## 10. Gantt — Q1 roadmap

`@startgantt` with absolute and **relative** scheduling (`starts at [X]'s end`),
which the importer resolves in a second pass, plus a milestone.

```plantuml
@startgantt
project starts 2026-01-05

[Design] starts 2026-01-06 and lasts 10 days
[Implement] starts at [Design]'s end and lasts 20 days
[Migrate data] starts 2026-01-27 and lasts 8 days
[QA] starts at [Implement]'s end and lasts 10 days
[Docs] starts at [Implement]'s end and lasts 5 days
[Launch] happens at [QA]'s end
@endgantt
```

> `Migrate data` crosses a month boundary, so its label spells out both months
> (`Jan 27 - Feb 4`). A bare end-day would be read against the *start* month.

---

## 11. Flowchart — export-only

PlantUML has no distinct flowchart family (activity diagrams fill that role),
so SelDiA does not *import* one — but any SelDiA flowchart **exports** to
PlantUML via `seldia export --to plantuml`, emitting a component-style graph.

```seldia
fl "Engine pipeline" {
    ingest [Ingest]
    parse [Parse]
    check diamond "Valid?"
    render [Render]
    out (SVG)
    errors [Diagnostics]

    ingest -> parse
    parse -> check
    check -> render: "yes"
    check -> errors: "no"
    render -> out
}
```

---

## Unsupported blocks degrade, they don't error

A PlantUML block SelDiA has no IR for is left as a plain code block. It is not
replaced with an error box, because a fence SelDiA cannot render is not
necessarily a fence that is *wrong*.

```plantuml
@startjson
{ "note": "valid PlantUML, no SelDiA IR — renders as plain code" }
@endjson
```

---

## Round-tripping

Everything above imports to IR and exports back to PlantUML:

```bash
seldia plantuml demo_plantuml.md          # render
seldia export diagram.puml --to plantuml  # IR -> PlantUML
seldia export diagram.puml --to mermaid   # cross-format
seldia export schema.puml --to sql-ddl    # ER -> DDL
```

Two round-trip losses are known and accepted:

- **Activity** exports the legacy graph-shaped form, so the structured
  `if`/`endif` spelling is not recovered (the graph itself is preserved).
- **Gantt** labels carry no year, so exporting IR that did not come from this
  importer assumes the current year.
