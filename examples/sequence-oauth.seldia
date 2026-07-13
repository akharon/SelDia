// ============================================================
// SelDiA — Example: OAuth Sequence Diagram
// ============================================================

diagram sequence "OAuth 2.0 Flow" {
    theme "sketchy-light"

    participant user: "User"
    participant app: "Client App"
    participant auth: "Auth Server"
    participant api: "Resource API"

    user -> app: Click "Login"
    app -> auth: GET /authorize
    auth --> user: Show login form
    user -> auth: Submit credentials

    alt valid credentials
        auth --> app: Authorization Code
        app -> auth: POST /token
        auth --> app: Access Token
        app -> api: GET /userinfo
        api --> app: User Data
        app --> user: Dashboard
    else invalid
        auth --> user: Error Message
    end
}
