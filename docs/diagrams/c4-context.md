# C4 Context Diagram

System-level context view showing how the system interacts with users and external systems.

## Syntax

```
diagram c4 context "Title" {
    person id: "Name" "Description"
    system id: "Name" "Description"
    system_Ext id: "Name" "Description"

    person --> system: "Relationship"
    system --> system_Ext: "Integration"
}
```

## Example

```
diagram c4 context "Internet Banking" {
    person customer: "Customer" "A bank customer"
    system banking: "Internet Banking" "Allows customers to manage accounts"
    system_Ext mainframe: "Mainframe Banking" "Core banking system"
    system_Ext email: "E-mail System" "Sends notifications"

    customer --> banking: "Views accounts, makes payments"
    banking --> mainframe: "Uses"
    banking --> email: "Sends e-mails using"
}
```
