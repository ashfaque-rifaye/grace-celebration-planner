# Security policy

## Reporting a vulnerability

Please open a [GitHub issue](https://github.com/ashfaque-rifaye/grace-celebration-planner/issues) with the `security` label, or contact the maintainer directly. Do not include a working exploit in a public issue.

## Threat model

Grace is a public, unauthenticated app that calls a paid or quota-limited LLM from its server, and it handles text about people's private events. That combination defines the threats.

| Threat                        | Mitigation                                                                                                                                                                                                                                                                                                       | Verified by                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Credential exposure**       | Keys are read only in server code. ESLint forbids client imports of server code. The Gemini key travels in a header rather than the URL, so it cannot appear in logs. `.env` is gitignored and CI fails on a committed key                                                                                       | `e2e/journey.spec.ts`, `llm.test.ts`, CI        |
| **Prompt injection**          | Structural: untrusted text is only sent as data inside the user message. Defence in depth: NFKC normalisation, removal of control, zero-width and bidi characters, neutralising known override phrases, length limits, and system-prompt guard rails. The UI shows **Input sanitised** when something was caught | `sanitize.test.ts`, `features.test.ts`          |
| **Excessive agency**          | The model cannot act. It returns proposals as data, a person approves each one, and it passes through the same reducer as a manual edit, which refuses impossible values                                                                                                                                         | `plan.test.ts`                                  |
| **Malicious model output**    | Output is schema-validated, then links, emails and markup are stripped, so a manipulated model cannot show a phishing link. `ground()` drops references to budget lines that do not exist. React escapes everything rendered, and `dangerouslySetInnerHTML` is not used                                          | `service.test.ts`, `features.test.ts`           |
| **Denial of wallet**          | A sliding-window limit per client (20 per minute), a global limit (600 per hour), bounded key space, token ceilings, 12 s attempt and 25 s total timeouts, response caching and in-flight sharing                                                                                                                | `rate-limit.test.ts`, `service.test.ts`         |
| **Rate-limit evasion**        | The client address is read from the right of `X-Forwarded-For`, counting trusted hops. The left end is client-controlled, so trusting it would let anyone reset their limit with a fake header                                                                                                                   | `app.test.ts`                                   |
| **Cross-site abuse**          | The API uses no cookies, and POSTs with a foreign `Origin` are refused, so another site cannot spend this app's quota from a visitor's browser                                                                                                                                                                   | `app.test.ts`, `e2e/journey.spec.ts`            |
| **XSS and clickjacking**      | CSP: `default-src 'none'`, same-origin scripts and styles, no `unsafe-*`, `frame-ancestors 'none'`. Also `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP and HSTS. A browser test fails on any CSP console error                                                               | `app.test.ts`, `e2e/journey.spec.ts`            |
| **Oversized or bad requests** | A 64 KB body limit, a required JSON content type, and Zod validation of every field. Validation errors name fields and never echo values                                                                                                                                                                         | `app.test.ts`                                   |
| **Information leakage**       | Unhandled errors return a generic message. Logs record failure types only, never prompts, user text or provider response bodies                                                                                                                                                                                  | `app.test.ts`, `llm.test.ts`, `service.test.ts` |
| **Hostile backups**           | Imported files are size-capped and validated against the full plan schema. Corrupt or tampered localStorage entries are skipped rather than trusted                                                                                                                                                              | `lib.test.ts`, `App.test.tsx`                   |
| **Export injection**          | CSV cells that begin with `=`, `+`, `-` or `@` are defused, and ICS text is escaped so an event name cannot add calendar properties                                                                                                                                                                              | `exports.test.ts`                               |
| **ReDoS**                     | Input is length-limited before any regex runs, and patterns avoid nested quantifiers                                                                                                                                                                                                                             | `sanitize.test.ts`                              |

## Privacy

- **No accounts and no server-side storage of plans.** Plans live in the visitor's localStorage.
- **Data minimisation.** `buildPlanContext` is the only view of a plan sent to the AI. Vendor contact details and notes are not included, and a test proves it.
- **The response cache is in memory**, keyed by a hash, and entries expire after 10 minutes.
- Text sent to an AI feature is processed by the configured provider under that provider's terms. Free-tier providers may use submitted content to improve their products, so Grace asks only for what each feature needs.

## Known limitations

- **Rate limits and the cache are per instance.** Under autoscaling, the effective limit is `limit × instances`. Redis would make it global.
- **No authentication**, deliberately, so anyone can try it. Rate limiting is the compensating control.
- **Phrase filtering cannot catch every attack.** It is defence in depth, which is why the design assumes a manipulated model and limits what it can do.

## Secret handling

Never commit `.env`. Use `.env.example` as the template, and set real keys as environment variables on the host. CI fails if a credential-shaped string or a `.env` file is committed.
