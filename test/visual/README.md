# Visual regression suite

Playwright-driven pixel-diff suite for the saas-crm web app. Catches the failure
modes that pure HTTP smokes miss:

- "Page goes blank" (React render error after hydration)
- "Renders but wrong layout" (CSS/Tailwind regression, dark-mode toggle broken,
  responsive breakpoint shifted, sidebar collapsed wrongly)
- Component-level regressions that don't break a contract test (button colour,
  spacing, missing icon)

## What it covers

15 page areas × 4 variants each (light/dark × desktop/mobile) ≈ 60+ baselines.
Some specs produce more: reports (4 sub-pages × 4 = 16), settings (4 × 4 = 16),
login pages (3 × 4 = 12), products (2 tabs × 4 = 8), leads (2 views × 4 = 8).

Total: ~92 baseline PNGs after a clean `--update-snapshots` run.

## Running locally

Preconditions:

1. The web app is running on `http://localhost:3000` (or set `E2E_BASE_URL`).
2. The API is running on `http://localhost:3001` (or set `E2E_API_URL`) — only
   needed by `client-detail.spec.ts` and `invoice-detail.spec.ts`, which fetch
   a real id from the API.
3. A test user exists. The default is `mschizas@fletcher.com.cy` /
   `password123` — override via `E2E_EMAIL` and `E2E_PASSWORD`. CI-style
   token-injection (`E2E_TOKEN`) also works.

### First run (no baselines yet)

```bash
pnpm test:visual --update-snapshots
```

Playwright will create every baseline under `test/visual/__screenshots__/` and
report all tests as passing. Inspect the generated PNGs by hand — they're your
baseline. If anything looks wrong, fix the UI (or the spec mask), delete the
bad PNG, and re-run.

### Subsequent runs

```bash
pnpm test:visual
```

Any pixel drift over `maxDiffPixelRatio: 0.01` (1 %) fails the suite. The
HTML report (`test/visual/playwright-report/index.html`) shows the actual,
expected, and diff side-by-side for every failure.

### Update one page after an intentional UI change

```bash
pnpm test:visual specs/clients-list.spec.ts --update-snapshots
```

## Snapshot policy

Baselines are **not** committed to git in this initial drop — see
`.gitignore`. Reasons:

- ~92 PNGs at 1440×900 + 375×812 ≈ 50–80 MB; bloats clones.
- Baselines should be deliberately blessed by a human looking at the actual
  rendered output. A "first commit, then break" cycle hides regressions
  inside the diff that introduces the baseline.

When the team agrees to start tracking baselines, remove the
`test/visual/__screenshots__/` line from `.gitignore` and commit them in a
dedicated PR titled "Visual regression baselines (snapshot)".

## Determinism guard-rails

The suite goes to lengths to keep diffs noise-free:

- Single browser (chromium) — cross-browser font rendering differences are
  noise, not signal.
- Single worker — concurrent runs against the same dev server cause cookie
  + nav races.
- Locale pinned to `en-US`, timezone to `UTC`.
- Animations + transitions disabled at the spec level AND injected as CSS.
- A global flaky-hide CSS in `setup.ts` masks: timestamps, `<time>`,
  `[data-testid="timestamp"]`, recharts/canvas, skeletons, online-indicator
  dots, scrollbar caret.
- Per-spec `extraCss` masks data-driven cells (table bodies, stat-card
  numbers, message previews).

## Adding a new page

1. Create `specs/<name>.spec.ts`.
2. Use `snapshotMatrix(page, { name, url, ... })` from `../setup`.
3. Add page-specific masks via `extraCss` for any data that varies per run.
4. Run `pnpm test:visual specs/<name>.spec.ts --update-snapshots` to seed.
5. Inspect the 4 generated PNGs by hand before committing.

## Known caveats

- **Charts**: every recharts/chart.js wrapper is hidden globally. The chart
  shape is therefore NOT covered by this suite — if you need to catch chart
  regressions, write a specialised spec that freezes the input data.
- **Long-poll pages**: `/inbox` doesn't `networkidle`. We rely on the stable
  selector + skeleton-disappear wait. If you add another long-poll page,
  pass `waitForNetworkIdle: false`.
- **Empty test database**: `client-detail` and `invoice-detail` skip cleanly
  if the API has no rows. Seed at least one client + one invoice for the
  full suite to run.
