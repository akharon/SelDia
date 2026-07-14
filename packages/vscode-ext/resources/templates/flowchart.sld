// SelDiA Flowchart Template
// Replace with your own nodes and edges.
// Shapes: (Rounded) [Rectangle] {Diamond/decision}
// Edge labels go inside |"..."| on the arrow.
diagram flowchart "My Flowchart" {
    theme "sketchy-light"

    start: (Start)
    process: [Process Step]
    decision: {Decision?}
    end: (End)

    start --> process
    process --> decision
    decision -->|"yes"| end
    decision -->|"no"| process
}
