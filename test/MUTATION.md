# Mutation testing (Stryker)

## What this is

Mutation testing measures **test quality**, not code coverage. Stryker
introduces small mutations into production source files (e.g. flips
`>` to `<`, replaces a string literal with `""`, deletes a method call)
and re-runs the unit suite against each mutated build. Three outcomes:

| Outcome      | Meaning |
|--------------|---------|
| **Killed**   | At least one unit test failed when the mutation was applied → tests detected the regression. Good. |
| **Survived** | All unit tests still passed even with the bug injected → tests don't actually verify that branch. Bad — likely a "dead test" that exercises the code without asserting the right thing. |
| **NoCoverage** | No test ever executed the mutated line → coverage gap. |
| **Timeout**  | The test suite hung (often an infinite loop introduced by the mutation) → counted as killed. |

The **mutation score** is `(killed + timeout) / (killed + timeout + survived + noCoverage)`.
Code-coverage % can be 100% with a mutation score of 30% — that
delta is exactly the population of "tests that pass when broken".

## Why we do this

We have ~138 backend unit tests. Mutation testing tells us how many of
those tests would actually fail if production logic were broken.
Surviving mutations point at specific lines where the assertions are
weak and need to be tightened. The score itself **is the deliverable** —
we don't fix surviving mutations as part of running this; we fix them
during normal feature work, guided by the report.

## Scope

Run is bounded to **10 services** with colocated `*.spec.ts` files
(see `apps/api/stryker.conf.json` `mutate` array). Running on the full
codebase would take hours and most of it isn't unit-tested anyway.

```
src/modules/clients/clients.service.ts
src/modules/invoices/invoices.service.ts
src/modules/leads/leads.service.ts
src/modules/products/products.service.ts
src/modules/email-settings/email-settings.service.ts
src/modules/ticket-spam-filters/ticket-spam-filters.service.ts
src/modules/auth/twofa.service.ts
src/modules/reports/reports.service.ts
src/modules/ai/ai-improve.service.ts
src/common/crypto/encrypt.ts
```

## How to run

```bash
# from repo root — runs Stryker, parses the JSON, regenerates the dashboard
pnpm test:mutation

# or just the Stryker CLI under apps/api
pnpm --filter api test:mutation

# also opens the detailed Stryker HTML report when finished
pnpm --filter api test:mutation:html
```

Reports land at:

- `test/.mutation/api/index.html` — Stryker's interactive, source-mapped
  HTML report. **This is the useful one** — click any file to see exactly
  which lines had surviving mutations and what the mutation was.
- `test/.mutation/api/report.json` — machine-readable, consumed by the
  test runner / dashboard.
- `test/dashboard/report.html` — unified dashboard with a `Mutation` tab
  showing overall score, per-file table, and a list of survived
  mutations. Has an "Open detailed HTML report" button that links to
  the Stryker HTML.

## Run time

**First run is slow — budget 15-25 minutes** on a 4-core machine.
Stryker:
1. Type-checks every mutant first (TypeScript checker eliminates
   mutants that wouldn't compile).
2. Runs the unit suite once to compute per-test coverage
   (`coverageAnalysis: "perTest"`).
3. For each surviving mutant, re-runs only the tests that cover its
   line.

Subsequent runs use Stryker's incremental mode if you pass
`--incremental` (not enabled by default — opt in only when you
*know* unit tests haven't materially changed).

## Cadence

- **Manual** — weekly or before a release. Not in CI.
- After landing a sizable test refactor, to confirm scores stayed up.
- Before claiming "we have N tests" in any external context.

## Thresholds

`apps/api/stryker.conf.json`:

```json
"thresholds": { "high": 80, "low": 60, "break": 50 }
```

- **>= 80%** — green (high-quality tests).
- **60-79%** — yellow (acceptable, some weak assertions).
- **< 60%** — red (significant gaps).
- **< 50%** — `stryker run` exits non-zero ("break" threshold).

We deliberately did NOT wire this exit code into CI — see "Cadence"
above. But you'll see a non-zero exit locally if scores collapse.

## Reading a surviving mutation

Stryker HTML report:

```
src/modules/products/products.service.ts:142
  mutator: ConditionalExpression
  original:  if (qty > 0)
  mutated:   if (true)
  status:    Survived
```

Translation: "I made `if (qty > 0)` always true, ran the unit suite,
and every test still passed. So no test cares whether `qty > 0`."

That's the actionable signal. Either:
- Add a test where `qty <= 0` to assert the early-return path, or
- Acknowledge the branch is unreachable in practice and add an
  `// stryker disable next-line` comment to suppress.

## Disabling mutations on a line

If a particular mutation is a known false positive (e.g. equivalent
mutant that's truly indistinguishable, or a defensive guard that
genuinely can't be reached):

```ts
// Stryker disable next-line all
if (this._neverNull == null) throw new Error('invariant');
```

Use sparingly — most "false positives" are real assertion gaps.

## Adding more files to the scope

Edit `apps/api/stryker.conf.json` `mutate` array. Each new file adds
roughly 30s-3min to the run depending on file size and number of
covering tests. Don't add files that have no `.spec.ts` — every
mutation will survive and the score will tank uselessly.
