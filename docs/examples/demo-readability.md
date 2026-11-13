# SelDiA — Readability Gallery

Examples of the legibility features: line jumps, label chips, group titles, parallel-run separation and shapes sized to their text. Check any of them from the terminal with `seldia check docs/examples/demo-readability.md`. See the [user guide](../user_guide.md#73-readability).

## Line jumps

Where one edge has to cross another, the later edge hops over with a small arc. Look at the two crossings in the middle of the graph.

```seldia
fl "Crossing edges with line jumps" {
    a [Source A]
    b [Source B]
    c [Source C]
    x [Sink X]
    y [Sink Y]
    z [Sink Z]

    a -> z
    b -> y
    c -> x
    a -> x
    c -> z
}
```

## Labelled edges in a dense flowchart

Each label sits on a background chip on its own edge. A label that cannot sit on its line moves aside and is tied back by a thin dashed leader.

```seldia
fl "Order handling" {
    start (Order placed)
    stock: {In stock?}
    pay [Charge card]
    ok: {Payment ok?}
    ship [Ship order]
    backorder [Create backorder]
    retry [Ask for new card]
    cancel (Cancelled)
    done (Delivered)

    start -> stock
    stock -> pay: "yes"
    stock -> backorder: "no"
    backorder -> pay: "when restocked"
    pay -> ok
    ok -> ship: "approved"
    ok -> retry: "declined"
    retry -> cancel: "gives up"
    ship -> done
}
```

## Nested groups with titles

Group titles stay clear of the nodes and edges inside, and the inner group stays inside the outer one.

```seldia
fl "Platform" {
    group "Cloud" {
        group "Backend" {
            api [API]
            worker [Worker]
        }
        group "Data" {
            db [Database]
            cache [Cache]
        }
    }
    web [Web app]
    web -> api: "HTTPS"
    api -> worker: "jobs"
    api -> db: "SQL"
    api -> cache: "reads"
    worker -> db: "writes"
}
```

## Fan-in and fan-out

Three producers feed one hub, and the hub feeds three consumers. Edges that share a corridor are nudged apart, so each one stays distinguishable.

```seldia
fl "Fan-in and fan-out" {
    p1 [Producer 1]
    p2 [Producer 2]
    p3 [Producer 3]
    hub [Message hub]
    c1 [Consumer 1]
    c2 [Consumer 2]
    c3 [Consumer 3]

    p1 -> hub
    p2 -> hub
    p3 -> hub
    hub -> c1
    hub -> c2
    hub -> c3
}
```

## Long labels in a diamond

The label wraps inside the usable area of the diamond, and the node grows until it fits.

```seldia
fl "Diamond text" {
    req [Incoming request]
    check: {Is the caller authenticated and allowed to access this resource?}
    serve [Serve resource]
    deny [Reject with 403]

    req -> check
    check -> serve: "yes"
    check -> deny: "no"
}
```

## Text in a hexagon and a cylinder

A hexagon wraps long text inside its slanted sides. The cylinder takes explicit `\n` line breaks and keeps its text between the curved top and bottom.

```seldia
fl "Cylinder and hexagon text" {
    ingest [Ingest service]
    store database "Customer orders\nand invoices\narchive"
    rule hex "Validate every order against the active pricing and tax rules"
    report [Monthly report]

    ingest -> rule
    rule -> store: "valid orders"
    store -> report
}
```

## Use case actors

Actors are drawn as stick figures with their label below, and the use cases are ovals sized to their text.

```seldia
uc "Library" {
    actor member "Member"
    actor librarian "Librarian"
    borrow [Borrow a book]
    returnbook [Return a book]
    catalogue [Maintain the catalogue]

    member -> borrow
    member -> returnbook
    librarian -> returnbook
    librarian -> catalogue
}
```

## C4 context with labelled relationships

People and systems use the C4 shapes. Each relationship label sits on its own line, away from the neighbouring boxes.

```seldia
c4c "Online Shop" {
    person customer "Customer" "Buys products"
    person admin "Shop admin" "Manages the catalogue"
    system shop "Online Shop" "Catalogue, basket and checkout"
    system_Ext payments "Payment Gateway" "Card processing"
    system_Ext mail "Email Service" "Order confirmations"

    customer -> shop: "Browses and orders"
    admin -> shop: "Edits products"
    shop -> payments: "Charges cards"
    shop -> mail: "Sends receipts"
}
```

## Clean edges and the sketch alternative

The same graph is drawn with rounded orthogonal edges by default. Setting `edgeStyle` to `sketch` in the engine config (`seldia.config.json` or `createEngine({ config: { render: { edgeStyle: 'sketch' } } })`) keeps the hand-drawn rough lines instead. One diagram can also choose with an `edges sketch` or `edges clean` line inside its fence, which beats the config. The first fence below uses the default, the second opts into sketch.

```seldia
fl "Default clean edges" {
    a [Plan]
    b [Build]
    c [Test]
    d [Release]
    e [Rollback]

    a -> b
    b -> c
    c -> d: "pass"
    c -> b: "fail"
    d -> e: "incident"
}
```

```seldia
fl "Sketch edges in this fence only" {
    edges sketch
    a [Plan]
    b [Build]
    c [Test]
    a -> b
    b -> c
    c -> b: "fail"
}
```

## Dense flowcharts

Four denser graphs for measuring layout. The first has long edges that skip layers and four edges converging on one node. The second is a service mesh with fan-in and skip-layer edges. The third is a DAG of diamonds with cross edges between the middle layers. The fourth has a decision node and two back-edges.

```seldia
diagram flowchart "Crossings" {
  a: [Client]
  b: [Gateway]
  c: [Auth]
  d: [Orders]
  e: [Billing]
  f: [DB]
  a --> b
  a --> e
  b --> c
  b --> d
  c --> f
  d --> f
  d --> e : invoice
  e --> f
  c --> e : token
  a --> f : direct
}
```

```seldia
fl "Service mesh" {
    web [Web app]
    mobile [Mobile API]
    edge [Edge proxy]
    gw [API gateway]
    auth [Auth service]
    users [User service]
    orders [Order service]
    catalog [Catalog service]
    pay [Payment service]
    queue (Event bus)
    notify [Notification service]
    store database "Primary store"

    web -> edge
    mobile -> edge
    edge -> gw
    gw -> auth
    gw -> users
    gw -> orders
    gw -> catalog
    orders -> pay
    orders -> queue
    queue -> notify
    web -> auth: "static token"
    edge -> notify: "fallback"
    users -> store
    orders -> store
    catalog -> store
    pay -> store
}
```

```seldia
fl "Diamond DAG" {
    s1 [Source 1]
    s2 [Source 2]
    s3 [Source 3]
    d1: {Valid?}
    d2: {Cached?}
    d3: {Priority?}
    m1: {Merge A?}
    m2: {Merge B?}
    x (Sink X)
    y (Sink Y)

    s1 -> d1
    s2 -> d1
    s2 -> d2
    s3 -> d2
    s3 -> d3
    d1 -> m1: "yes"
    d1 -> m2: "no"
    d2 -> m1: "hit"
    d2 -> m2: "miss"
    d3 -> m1
    d3 -> m2
    m1 -> x
    m2 -> y
    m1 -> y
    d3 -> x: "high"
}
```

```seldia
fl "Retry workflow" {
    start (Start)
    fetch [Fetch record]
    check: {Record valid?}
    fix [Repair record]
    save [Save record]
    verify: {Saved OK?}
    done (Done)
    fail (Give up)

    start -> fetch
    fetch -> check
    check -> save: "yes"
    check -> fix: "no"
    fix -> check: "retry"
    save -> verify
    verify -> done: "yes"
    verify -> fetch: "reload"
    verify -> fail: "no"
}
```
