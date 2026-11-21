// ============================================================
// SelDiA — Example: C4 Context Diagram
// ============================================================

diagram c4 context "Internet Banking System" {
    theme "sketchy-dark"

    person customer: "Bank Customer" { x: 708, y: 60, fill: "#ff8800" }
    system banking: "Internet Banking System" { x: 507, y: 329 }
    system_Ext mainframe: "Mainframe Banking" { x: 920, y: 398 }
    system_Ext email: "Email System" { x: 918, y: 276 }

    customer --> banking: "Views accounts, makes payments" { via: [751.3, 261, 575, 261] }
    banking --> mainframe: "Gets account info" { via: [702, 404.6, 702, 443] }
    banking --> email: "Sends notifications" { via: [702, 383, 702, 336] }
    email --> customer: "Sends emails to" { via: [794.7, 310, 794.7, 310] }
    system node5: "New Node 5" "Description" { x: 512, y: 476 }
    node5 --> banking: "Uses"
}
