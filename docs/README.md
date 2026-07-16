# SelDiA Documentation

This directory contains user-facing and reference documentation for SelDiA.

## Contents

- **[user_guide.md](./user_guide.md)** — How to use SelDiA: DSL syntax, diagram types, examples, configuration
- **[arch.md](./arch.md)** — Architecture and internals: system design, component overview, plugin system
- **[market.md](./market.md)** — Competitive position vs. Mermaid/PlantUML/D2, and where the leverage is
- **[next_steps.md](./next_steps.md)** — The current roadmap: what to build next and why, plus open technical debt
- **[index.md](./index.md)** — Documentation index and navigation

> `user_guide.md` and `arch.md` document the intended DSL/architecture and have known drift from the implemented subset (nested object-value syntax, `.sld` vs `.seldia`, some packages listed as wired in that aren't) — see [next_steps.md §3](./next_steps.md#3-known-technical-debt-carried-from-prior-internal-review) before treating either as ground truth.

## Getting Started

New to SelDiA? Start with [user_guide.md](./user_guide.md) for:
- Installation and setup
- Basic DSL syntax
- Supported diagram types
- Examples you can copy and modify

## For Contributors

Want to understand the codebase? See [arch.md](./arch.md) for:
- Project structure
- How the parser and rendering pipeline work
- Plugin architecture
- How to extend SelDiA with new diagram types

## Viewing Documentation

The documentation is built with VitePress and deployed to [seldia.dev](https://seldia.dev).

To build and preview locally:

```bash
npm run docs:build
npm run docs:preview
```

## Contributing to Docs

When updating documentation:

1. **Keep it concise** — Use clear, active voice
2. **Use examples** — Include code samples and visual references
3. **Link strategically** — Reference related sections
4. **Update index** — If adding new pages, update navigation
5. **Check links** — Ensure all cross-references work
6. **Review in preview** — See how it renders before committing

## What Belongs in Docs vs. GitHub Issues

**Docs:**
- How to use SelDiA (user guide)
- How SelDiA works (architecture)
- Example diagrams and patterns
- Configuration reference
- Troubleshooting and FAQs

**GitHub Issues:**
- Feature requests
- Bug reports
- Discussions and proposals
- Project roadmap and milestones

**GitHub Discussions (when available):**
- Questions from users
- Share examples and workflows
- General discussion and feedback

This keeps documentation focused on reference and learning, while GitHub issues/discussions handle active development and community engagement.
