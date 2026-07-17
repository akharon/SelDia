diagram flowchart "Auth Flow" {
    theme "sketchy-light"

    authService [Auth Service]
    userDb (User DB)
    tokenCache [Token Cache]
    apiGateway [API Gateway]

    apiGateway --> authService
    authService --> userDb
    authService --> tokenCache
}
