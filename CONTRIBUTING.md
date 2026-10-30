# Contributing

## Getting set up

```bash
nvm use                # Node 22 (see .nvmrc)
npm install
cp .env.example .env   # optional: add GEMINI_API_KEY
npm run dev            # http://localhost:5173
```

The app runs without a key: the deterministic planner answers and the badge says **Offline planner**.

## Before opening a PR

```bash
npm run verify     # format, lint, types, coverage thresholds, build, bundle budget
npm run test:e2e   # browser tests (first run: npx playwright install chromium)
```

## Architectural rules

ESLint enforces the first two, and review enforces the rest.

1. **`src/shared` stays pure.** No I/O, framework, or clock. Pass "today" in.
2. **Client code never imports server code.** That boundary is what keeps keys out of the browser.
3. **All plan changes go through `planReducer`,** including anything the AI suggests.
4. **Every AI feature has a deterministic fallback.** Show help rather than an error.
5. **Every AI output carries a `reasoning`,** shown as a **Why** line, and a badge saying who answered.
6. **Untrusted text only ever travels as data in the user message,** never in a system prompt.
7. **The model does not do arithmetic.** It may propose numbers, but code validates them.
8. **Nothing about a person leaves the browser unless a feature needs it.** `buildPlanContext` is that boundary.

## Adding an AI feature

1. Add its input and output schemas to `aiContracts` in `src/shared/contracts.ts`.
2. Add its fallback to `src/server/ai/fallbacks.ts`.
3. Add its entry to `AI_FEATURES` in `src/server/ai/features.ts`.

TypeScript flags whichever of these you forget, and the pipeline supplies validation, sanitising, caching, limits and failover.

## Testing expectations

- Test behaviour and edge cases, not implementation details.
- For a rule that must always hold, prefer a property test with fast-check.
- Inject time and `fetch` rather than using real delays or a real network. Automated tests must never call a real model.
- New UI states need an accessibility scan: `expect(await a11yViolations(container)).toEqual([])`.
- New colours go in the design tokens and get a pair in `src/client/tokens.test.ts`.

## Commit style

A short imperative subject, with a body explaining why.
