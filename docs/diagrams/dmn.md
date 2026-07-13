# DMN Decision Table

Decision Model and Notation (DMN) for business rules.

## Syntax

```
diagram dmn "Title" {
    input name: type "Description"
    rule id: condition => "OUTPUT"
    hitPolicy: first
}
```

## Example

```
diagram dmn "Loan Approval" {
    input age: number "Applicant Age"
    input income: number "Annual Income"
    input creditScore: number "Credit Score"

    rule r1: age >= 18 and income > 30000 and creditScore > 700 => "APPROVE"
    rule r2: age >= 18 and income > 30000 and creditScore <= 700 => "MANUAL_REVIEW"
    rule r3: age < 18 => "DENY"
    rule r4: income <= 30000 and creditScore <= 600 => "DENY"

    hitPolicy: first
}
```
