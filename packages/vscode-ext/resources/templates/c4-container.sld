diagram c4 container "Container View" {
    theme "sketchy-light"

    container spa: "SPA" "React" "Client-side application"
    container api: "API" "Go" "RESTful API"
    containerDb db: "Database" "PostgreSQL" "Stores data"

    spa --> api: "JSON/HTTPS"
    api --> db: "SQL/TCP"
}
