---
name: plan
description: "Create implementation plans. Use for feature planning, system design, architecture, roadmaps."
argument-hint: "[task description]"
---

# Planning Skill

Create technical implementation plans through research, codebase analysis, and solution design.

## Workflow

1. **Research** — Understand requirements, read relevant docs/code
2. **Analyze** — Identify constraints, patterns, dependencies
3. **Design** — Propose solution with clear phases
4. **Document** — Write plan.md with frontmatter + phases

## Modes

| Flag | Mode | Description |
|------|------|-------------|
| `--auto` | Auto-detect | Analyze complexity, pick mode (default) |
| `--fast` | Fast | Skip research, minimal plan |
| `--hard` | Hard | Deep research, thorough analysis |

## Plan File Format

Every plan.md starts with YAML frontmatter:

```yaml
---
title: "{title}"
status: pending
priority: P2
effort: "{estimate}"
created: {YYYY-MM-DD}
---
```

## Phase Structure

Break plan into numbered phases:
- Each phase has clear objective, deliverables, effort estimate
- Phases are sequential with dependencies noted
- Include code snippets/pseudocode when helpful

## Rules

- DO NOT implement code — only plan
- Be concise. Sacrifice grammar for brevity.
- YAGNI, KISS, DRY always
- **Every plan MUST include:** `## Docs Impact`, `## Test Strategy`, `## Observability` sections
- List unresolved questions at end
- Output plan file path + summary when done
