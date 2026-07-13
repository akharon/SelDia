diagram sequence "Sequence Diagram" {
    theme "sketchy-light"

    participant alice: Alice
    participant bob: Bob
    participant server: Server

    alice -> bob: Hello
    bob --> alice: Reply
    alice -> server: Request
    server --> alice: Response
}
