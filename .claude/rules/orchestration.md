# Orchestration Rules

**Three Pillars enforced in every step.** See `rules/three-pillars.md`.

## Workflow

Sequential pipeline for significant work:

1. **Plan** — delegate to `planner` agent. Must include: docs impact, test strategy, observability plan.
2. **Test (Red)** — delegate to `tester` agent. Write failing tests FIRST.
3. **Code** — implement per plan. Minimal to pass tests. Include logging/observability.
4. **Test (Green)** — run tests. All green. No mocks/fakes to pass.
5. **Docs** — update/create docs per plan. Same commit as code.
6. **Review** — delegate to `reviewer` agent. Verify all 3 pillars. Fix critical/high.

Skip steps 1/6 for trivial changes (<20 lines, single file). Never skip tests.

## Delegation Protocol

### Sequential Chaining
When tasks have dependencies:
- Planning → Implementation → Testing → Review
- Each agent completes before next begins
- Pass context between agents

### Parallel Execution
For independent tasks:
- Ensure no file conflicts
- Plan integration points before spawning

## Code Quality

- **File naming**: kebab-case, descriptive (self-documenting for LLM tools)
- **File size**: code files >200 lines → consider splitting
- **Updates**: modify existing files, don't create enhanced copies
- **Compile check**: run lint/build after changes
- **Error handling**: try-catch, cover security standards

## Pre-commit Rules

- Run linting before commit
- Run tests before push
- Conventional commit messages, no AI attribution
- **NEVER** commit secrets (env files, API keys, credentials)

## Debugging

When bugs reported:
1. Delegate to `debugger` agent for analysis
2. Read report, implement fix
3. Run tests, verify fix
4. If tests fail → fix and re-test until green
