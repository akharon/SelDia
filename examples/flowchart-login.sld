diagram flowchart "User Login Flow" {
    theme "sketchy-light"

    start: (Start) { x: 160, y: 416 }
    enterEmail: [/Enter Email/] { x: 152, y: 251 }
    enterPassword: [/Enter Password/] { x: 5, y: 498 }
    validate: { Validate Credentials?, x: 2, y: 652 }
    dashboard: [Show Dashboard] { x: 57, y: 1000 }
    error: [Show Error] { x: 270, y: 669 }
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
    node9: [dfd] { x: 164, y: 522 }
    start --> node9
}
