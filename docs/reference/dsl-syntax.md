# DSL Syntax Reference

## Grammar

```
diagram        ::= "diagram" diagramType [stringLiteral] [metadata] "{" diagramBody "}"
diagramType    ::= "flowchart" | "sequence" | "class" | "er" | "state"
                 | "usecase" | "activity" | "component" | "deployment"
                 | "c4" ("context" | "container" | "component" | "code")?
                 | "bpmn" | "dmn" | "gantt" | "mindmap" | "network"
                 | "chart" ("bar" | "line" | "pie" | "radar" | "scatter" | "sankey")?
                 | "gitgraph" | "form" | "block" | "timeline"

diagramBody    ::= (themeDecl | layoutDecl | styleBlock | nodeDecl
                 |  edgeDecl | groupDecl | sectionDecl | comment)*

nodeDecl       ::= identifier ":" shapeDecl [stringLiteral] [styleBlock]
shapeDecl      ::= "(" ")" | "[" "]" | "{" "}" | "<" ">" | "[||]"
                 | "{{" "}}" | "[()]" | "[/" "/]" | "[\" "\\]"

edgeDecl       ::= nodeRef edgeOp nodeRef [edgeLabel] [edgeHints]
edgeOp         ::= "-->" | "<-->" | "---" | "..>" | "==>" | "-..->"
```

## Top-Level Structure

```
diagram <type> "<title>" {
    theme "<theme_name>"
    layout <engine>

    // Diagram body
}
```

## Identifiers

- Alphanumeric + `_` + `-`
- Quoted strings for labels with special characters
- Case-sensitive

## Comments

```
// Single line
/* Multi-line
   comment */
```
