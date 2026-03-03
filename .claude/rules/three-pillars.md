# Three Pillars

Every feature, fix, and refactor MUST honor all 3 pillars. Non-negotiable.

---

## 1. Document-Driven Development

**Docs before or alongside code. Never after.**

- Every plan includes `## Docs Impact` — what to create/update
- New module/feature → create/update docs BEFORE coding
- Changed public APIs → update docs in same commit
- Docs location: `./docs/` (project-defined structure)
- Inline code comments for non-obvious logic
- README stays current with project state

**Violation**: code merged without doc update = incomplete work.

---

## 2. Test-Driven Development

**Red → Green → Refactor. Always.**

- Write failing test FIRST (defines expected behavior)
- Implement minimal code to pass
- Refactor. Tests still green.
- No code without corresponding test
- Test files: `*.test.*` / `*.spec.*` / `__tests__/`
- Delegate to `tester` agent for test planning + execution
- No mocks/fakes to trick builds — test real behavior (mocking deps in unit tests is fine, faking entire flows to pass CI is not)

**Violation**: code without tests = incomplete work.

---

## 3. Observability-Driven Development

**If you can't observe it, you can't debug it.**

- Structured logging (JSON preferred) for key operations
- Every operation emits: start, success, failure events
- Error boundaries with context (what, where, why, input)
- No silent `catch {}` — always log or re-throw with context
- Performance-critical paths: add timing instrumentation
- Services: health check endpoint mandatory
- Use log levels correctly: `debug` for dev, `info` for ops, `warn` for recoverable, `error` for failures

**Patterns:**
```
// Good: structured, contextual
logger.info({ action: 'user_created', userId, duration_ms: 42 });

// Bad: unstructured, no context
console.log('done');
```

```
// Good: error with context
catch (err) {
  logger.error({ action: 'payment_failed', orderId, error: err.message });
  throw err;
}

// Bad: silent swallow
catch (err) {}
```

**Violation**: code with silent errors or no logging = incomplete work.
