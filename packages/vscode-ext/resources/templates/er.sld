// SelDiA Entity-Relationship Template
// Each entity is a node whose label uses \n to list attributes:
//   first line = entity name; PK / FK mark key columns.
// Relationship cardinality goes in the edge label, e.g. |"1 : *"|.
diagram er "Entity Relationship" {
    theme "sketchy-light"

    user: "User\nid: UUID PK\nname: string\nemail: string"
    order: "Order\nid: UUID PK\nuserId: UUID FK\ntotal: decimal\ncreated: datetime"
    product: "Product\nid: UUID PK\nname: string\nprice: decimal"

    user -->|"1 : *"| order
    order -->|"* : *"| product
}
