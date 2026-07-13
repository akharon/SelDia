diagram usecase "Use Cases" {
    theme "sketchy-light"

    actor user: "User"
    actor admin: "Admin"

    (Login)
    (View Dashboard)
    (Manage Users)
    (Generate Reports)

    user --> Login
    user --> View Dashboard
    admin --> Manage Users
    admin --> Generate Reports
    admin --> Login
}
