// SelDiA Class Diagram Template
// Each class is a node whose label uses \n to separate compartments:
//   first line  = class name
//   lines with () = operations (methods)
//   other lines  = attributes (fields); +/-/# mark visibility.
diagram class "Class Diagram" {
    theme "sketchy-light"

    user: "User\n+id: UUID\n+name: string\n+email: string\n+getName(): string"
    order: "Order\n+id: UUID\n+total: Money\n+status: string"

    user -->|"1 : *"| order
}
