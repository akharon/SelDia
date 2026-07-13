// ============================================================
// SelDiA — Example: C4 Context Diagram
// ============================================================

diagram c4 context "Internet Banking System" {
    theme "sketchy-dark"

    person customer: "Bank Customer"
    system banking: "Internet Banking System"
    system_Ext mainframe: "Mainframe Banking"
    system_Ext email: "Email System"

    customer --> banking: "Views accounts, makes payments"
    banking --> mainframe: "Gets account info"
    banking --> email: "Sends notifications"
    email --> customer: "Sends emails to"
}
