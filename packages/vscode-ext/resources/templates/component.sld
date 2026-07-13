diagram component "Component Architecture" {
    theme "sketchy-light"

    web: [Web Frontend]
    api: [API Gateway]
    auth: [Auth Service]
    payment: [Payment Service]
    db: [Database]

    web --> api
    api --> auth
    api --> payment
    api --> db
    db --> auth
    db --> payment
}
