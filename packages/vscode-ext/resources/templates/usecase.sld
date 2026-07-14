// SelDiA Use-Case Template
// Declare actors and use cases (oval nodes), then connect actors to the
// use cases they participate in.
diagram usecase "Use Cases" {
    theme "sketchy-light"

    actor user: "User"
    actor admin: "Admin"

    login: (Login)
    dashboard: (View Dashboard)
    manageUsers: (Manage Users)
    reports: (Generate Reports)

    user --> login
    user --> dashboard
    admin --> login
    admin --> manageUsers
    admin --> reports
}
