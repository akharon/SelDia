diagram flowchart "User Login Flow" {
    theme "sketchy-light"

    start: (Start)
    enterEmail: [/Enter Email/]
    enterPassword: [/Enter Password/]
    validate: {Validate Credentials?}
    dashboard: [Show Dashboard]
    error: [Show Error]
    lockout: [Lock Account]
    end: (End)

    start --> enterEmail
    enterEmail --> enterPassword
    enterPassword --> validate
    validate -->|"Valid"| dashboard
    validate -->|"Invalid"| error
    error --> enterEmail
    error --> lockout
    dashboard --> end
    lockout --> end
}
