diagram chart bar "Monthly Sales" {
    data {
        categories: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
        series "Revenue" { 120, 200, 150, 180, 220, 250 }
        series "Costs" { 80, 100, 90, 95, 110, 120 }
    }
    options {
        xAxis { title: "Month" }
        yAxis { title: "Amount (k€)" }
        legend { position: bottom }
    }
}
