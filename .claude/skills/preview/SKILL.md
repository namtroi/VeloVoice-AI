---
name: preview
description: "Generate visual explanations — Mermaid diagrams, ASCII art, architecture visualizations."
argument-hint: "--diagram|--explain|--ascii [topic]"
---

# Preview Skill

Generate visual explanations for complex code, architecture, and data flows.

## Modes

| Flag | Output |
|------|--------|
| `--diagram [topic]` | Mermaid architecture/flow diagram |
| `--explain [topic]` | Visual explanation with ASCII + Mermaid |
| `--ascii [topic]` | Terminal-friendly ASCII-only output |

## When to Use

- Topic has 3+ interacting components
- User asks "explain", "how does X work", "visualize"
- Architecture decisions need communication

## Mermaid Guidelines

- Use `graph TD` for top-down flows
- Use `sequenceDiagram` for interactions
- Use `classDiagram` for structure
- Quote labels with special chars: `id["Label (info)"]`
- Keep diagrams focused — max 15 nodes

## Output

Save visuals to project directory (e.g., `docs/diagrams/` or `plans/visuals/`).
Render inline in response for immediate feedback.
