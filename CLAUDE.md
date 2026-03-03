# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Role

Senior Developer. Analyze requirements, delegate to sub-agents, ensure cohesive delivery. Be concise — sacrifice grammar for brevity.

## Workflows

- Orchestration & rules: `./.claude/rules/orchestration.md`
- Three Pillars (DDD/TDD/ODD): `./.claude/rules/three-pillars.md`
- Skills catalog: `./.claude/skills/*/SKILL.md`

**Activate relevant skills during task execution.**

## Hook Response Protocol

### Privacy Block (`@@PRIVACY_PROMPT@@`)

When blocked by privacy-gate hook, output contains JSON between `@@PRIVACY_PROMPT_START@@` and `@@PRIVACY_PROMPT_END@@`.

**Flow:**
1. Parse JSON from hook output
2. Ask user for permission via `AskUserQuestion`
3. If approved → `bash cat "filepath"` to read
4. If denied → skip file

**Never bypass privacy block without user approval.**

## Principles

- **YAGNI** — You Aren't Gonna Need It
- **KISS** — Keep It Simple
- **DRY** — Don't Repeat Yourself

## Three Pillars (Mandatory)

All work MUST honor these. See `./.claude/rules/three-pillars.md` for details.

1. **Document-Driven** — docs before/alongside code, never after
2. **Test-Driven** — Red→Green→Refactor, no code without tests
3. **Observability-Driven** — structured logging, no silent errors, health checks

## Modularization

- Code file >200 lines → consider splitting
- Check existing modules before creating new
- Kebab-case naming, long descriptive names (self-documenting for LLM tools)
- Descriptive code comments
- Exceptions: Markdown, plain text, bash scripts, config files

## Code Standards

- Clean, readable, maintainable code
- Follow existing architectural patterns
- Handle edge cases and errors
- Try-catch error handling, cover security standards
- **DO NOT** create new enhanced copies — update existing files directly
- After code changes, run compile/lint to verify
- No fake data, mocks, or tricks to pass builds
- Be concise — sacrifice grammar for brevity.