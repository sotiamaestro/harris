# Bug-fix example

This example gives Harris a tiny TypeScript codebase with a real failing test.
The bug is an off-by-one error in `sample-codebase/utils.ts`: `takeFirst`
returns one item fewer than requested.

Run the scenario from the repository root:

```bash
npx tsx examples/bug-fix/run.ts
```

If `GEMINI_API_KEY` is not set, Harris uses its offline mock mode. That keeps the
example runnable without paid credentials while still exercising the swarm
orchestration path. Set `GEMINI_API_KEY` for a semantic run against the actual
bug-fix goal.

The sample codebase contains:

- `utils.ts`: helper functions, including the off-by-one bug.
- `api.ts`: a small API layer that calls the helper.
- `utils.test.ts`: tests that expose the bug.
