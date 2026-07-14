// SelDiA Mind-Map Template
// Model the map as a central root node with branches radiating out via edges.
diagram mindmap "Mind Map" {
    theme "sketchy-light"

    root: (Project)

    fe: [Frontend]
    dashboard: [Dashboard]
    profile: [User Profile]
    settings: [Settings]

    be: [Backend]
    api: [API]
    database: [Database]
    auth: [Auth]

    ops: [DevOps]
    cicd: [CI/CD]
    deploy: [Deployment]
    monitor: [Monitoring]

    root --> fe
    root --> be
    root --> ops

    fe --> dashboard
    fe --> profile
    fe --> settings

    be --> api
    be --> database
    be --> auth

    ops --> cicd
    ops --> deploy
    ops --> monitor
}
