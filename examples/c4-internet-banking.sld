// ============================================================
// SelDiA — Example: C4 Context Diagram
// ============================================================

diagram c4 context "Internet Banking System" {
    theme "sketchy-dark"

    person customer: "Bank Customer" { x: 708, y: 87 }
    system banking: "Internet Banking System" { x: 506, y: 266 }
    system_Ext mainframe: "Mainframe Banking" { x: 818, y: 410 }
    system_Ext email: "Email System" { x: 813, y: 277 }

    customer --> banking: "Views accounts, makes payments"
    banking --> mainframe: "Gets account info"
    banking --> email: "Sends notifications"
    email --> customer: "Sends emails to"
}
