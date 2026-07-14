// SelDiA DMN Template
// Model a decision as inputs feeding a decision node, branching to outcomes.
// Shapes: [/input/] {decision} (outcome)
diagram dmn "Loan Decision" {
    theme "sketchy-light"

    applicant: [/Applicant Data/]
    age: {Age >= 18?}
    credit: {Credit Score > 700?}
    approve: (Approve)
    review: (Manual Review)
    deny: (Deny)

    applicant --> age
    age -->|"no"| deny
    age -->|"yes"| credit
    credit -->|"yes"| approve
    credit -->|"no"| review
}
