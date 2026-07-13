diagram c4 context "System Context" {
    theme "sketchy-light"

    person customer: "Customer" "A user of the system"
    system app: "My System" "The system being built"
    system_Ext ext: "External API" "Third-party service"
    system_Ext email: "Email Service" "Sends notifications"

    customer --> app: "Uses"
    app --> ext: "Integrates via API"
    app --> email: "Sends emails"
}
