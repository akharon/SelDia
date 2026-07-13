diagram network "Network Topology" {
    theme "sketchy-light"

    internet: [Internet]
    firewall: {Firewall}
    switch: [Core Switch]
    app: [Application Server]
    db: [Database Server]

    internet --> firewall
    firewall --> switch
    switch --> app
    switch --> db
}
