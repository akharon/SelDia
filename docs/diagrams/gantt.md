# Gantt Chart

Project timelines with tasks, milestones, and sections.

## Syntax

```
diagram gantt "Title" {
    section "Phase Name" {
        task id: "Task Name" startDate to endDate
    }
    milestone id: "Milestone" at date
}
```

## Example

```
diagram gantt "Project Alpha" {
    section "Planning" {
        task t1: "Requirements" 2025-01-06 to 2025-01-17
        task t2: "Architecture" 2025-01-20 to 2025-01-31
    }
    section "Development" {
        task t3: "Sprint 1" 2025-02-03 to 2025-02-21
        task t4: "Sprint 2" 2025-02-24 to 2025-03-14
    }
    milestone m1: "MVP Release" at 2025-03-17
}
```
