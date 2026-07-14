// SelDiA Gantt / Project-Plan Template
// Group tasks into named sections; arrows show dependencies (task order).
diagram gantt "Project Plan" {
    theme "sketchy-light"

    section "Planning" {
        req: [Requirements]
        design: [Architecture]
    }
    section "Development" {
        sprint1: [Sprint 1]
        sprint2: [Sprint 2]
    }
    section "Release" {
        mvp: (MVP Release)
    }

    req --> design
    design --> sprint1
    sprint1 --> sprint2
    sprint2 --> mvp
}
