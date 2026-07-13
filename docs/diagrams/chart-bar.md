# Bar Chart

Bar and column charts with Rough.js styling.

## Syntax

```
diagram chart bar "Title" {
    data {
        categories: ["Label1", "Label2"]
        series "Name" { value1, value2 }
    }
    options {
        xAxis { title: "X Axis" }
        yAxis { title: "Y Axis" }
        legend { position: bottom }
    }
}
```

## Example

```
diagram chart bar "Monthly Sales" {
    data {
        categories: ["Jan","Feb","Mar","Apr","May","Jun"]
        series "Revenue" { 120, 200, 150, 180, 220, 250 }
        series "Costs"   { 80,  100, 90,  95,  110, 120 }
    }
    options {
        xAxis { title: "Month" }
        yAxis { title: "Amount (k€)" }
        legend { position: bottom }
    }
}
```
