// SelDiA Flowchart Template
// Replace with your own nodes and edges.
diagram flowchart "My Flowchart" {
    theme "sketchy-light"

    start: (Start)
    process: [Process Step]
    decision: {Decision?}
    end: (End)

    start --> process
    process --> decision
    decision -->|yes| end
    decision -->|no| process
}
