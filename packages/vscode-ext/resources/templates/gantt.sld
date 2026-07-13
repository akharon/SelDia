diagram gantt "Project Plan" {
    theme "sketchy-light"

    section "Planning" {
        task req: "Requirements" 2025-01-06 to 2025-01-17
        task design: "Architecture" 2025-01-20 to 2025-01-31
    }
    section "Development" {
        task sprint1: "Sprint 1" 2025-02-03 to 2025-02-21
        task sprint2: "Sprint 2" 2025-02-24 to 2025-03-14
    }
    milestone mvp: "MVP Release" at 2025-03-17
}
