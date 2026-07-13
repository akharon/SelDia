diagram dmn "Decision Table" {
    input age: number "Applicant Age"
    input income: number "Annual Income"
    input creditScore: number "Credit Score"

    rule r1: age >= 18 and income > 30000 and creditScore > 700 => "APPROVE"
    rule r2: age >= 18 and income > 30000 and creditScore <= 700 => "MANUAL_REVIEW"
    rule r3: age < 18 => "DENY"
    rule r4: income <= 30000 and creditScore <= 600 => "DENY"
    rule r5: income <= 30000 and creditScore > 600 => "MANUAL_REVIEW"

    hitPolicy: first
}
