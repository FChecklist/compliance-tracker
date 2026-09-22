# dpdp-app/e2e -- the browser tests

Three specs, one config (`../playwright.config.ts`), one CI job
(`.github/workflows/dpdp-app-ci.yml`, `dpdp-app-e2e`) that runs every
`*.spec.ts` here against the BUILT site in mock mode:

| spec | what it proves |
|---|---|
| `agent-by-role.spec.ts` | WO-DPDP-012 §6 -- an assistant can drive the public site by accessible names alone, up to the email step (this file's own sections below) |
| `step5-by-role.spec.ts` | WO-DPDP-011 Step 5 -- the remaining WO-010 screens, by role |
| `acceptance-70.spec.ts` | WO-DPDP-011 Step 6 -- the spec's 70 acceptance checks (`LAW-01..18`, `FIRST-01..28`, `ROLES-01..24`), one test each; the derivation table is `ACCEPTANCE-70.md` |

All three share one rule: every locator is `getByRole` / `getByLabel` /
`getByText` / `getByTitle` with an accessible name. The spec they are
checked against is `../spec/veridian-dpdp.html`, the owner's one-page product
spec, copied verbatim. The mock (`../src/lib/mock-client.ts`) is seeded per
test with `?mock=<scenario>` on `/app/` -- see `ACCEPTANCE-70.md`, "The
mock", for the scenarios and what each world contains.

## What agent-by-role proves

WO-DPDP-012 §6, verbatim:

> Semantic HTML: real `<button>`, `<a>`, `<label>`, `<form>`. Every control has a
> clear accessible name. Nothing works only on hover. An assistant can complete
> the public sign-up up to the email step -- the email click stays with the
> human. No CAPTCHA on public pages; rate-limit instead. Test with an automated
> browser driving the site by accessible names only (Playwright getByRole). If
> a step cannot be found by role and name, it is a bug.

`agent-by-role.spec.ts` is that test. Every locator in it is `getByRole`,
`getByLabel` or `getByText` with the control's exact accessible name. There is
no CSS selector, test id or XPath anywhere in the file, and that restriction is
the proof: an assistant driving a browser sees the accessibility tree and
nothing else, so a step this spec can reach is a step an assistant can reach.
A step it cannot reach is a bug in the HTML, and the fix goes in the HTML --
never in the spec's locators.

What it covers, against the **built** site (`dist/`, served by `vite preview`,
which is what Cloudflare Pages serves):

| § 6 clause | Test | Surface |
|---|---|---|
| an assistant can complete the sign-up up to the email step | the journey: root chooser -> "I do this for clients" -> firm landing -> `/app/` -> `Your email` -> `Email me a sign-in link` -> **Check your email** | `/`, `/dpdp-firm/`, `/app/` |
| the email click stays with the human | the journey stops on the check-your-email screen and asserts it is **not** signed in (no "Signed in as", no "Sign out") | `/app/` |
| real `<a>`/`<button>`/`<label>`/`<form>`, clear accessible names | one `<h1>` per page with its exact name; the primary call-to-action ("Start free →") found by role + name; the email field found by its `<label>`; every button, link and textbox has a non-empty accessible name, failing with the element's `outerHTML` | all four |
| nothing works only on hover | every `<a>` and `<button>` -- including any hidden from the accessibility tree -- is visible with the pointer parked at (0,0) | all four |
| no CAPTCHA on public pages | no frame, text, title, label, image or markup mentioning captcha / recaptcha / hcaptcha / turnstile | all four |

"All four" = the three public pages in `src/lib/public-surface.mjs` plus
`/app/`, which is private to crawlers but is where the sign-in lives, so it is
the last step of the public journey.

Two honest limits:

- The landings' "Start free →" links point at the Next.js login host for now
  (see the nav comment in `dpdp-firm/index.html`), so the journey navigates to
  `/app/` directly rather than following that link. When the link is switched
  to `/app/`, the spec should follow it instead.
- Rate limiting (the WO's alternative to CAPTCHA) is Supabase Auth's own OTP
  limit, server-side. This spec proves the absence of a CAPTCHA, not the
  presence of the limit.

## Why the sign-up stops at the email step, by design

In mock mode (`VITE_MOCK=1`, `src/lib/mock-client.ts`) the fake client "signs
the visitor in" 1.5 s after the form is sent, standing in for the human opening
the emailed link. The spec **freezes the page's clock** (`page.clock.install()`
+ `pauseAt`) before filling the form, so that timer never fires. What the spec
sees is exactly what an assistant is left with: the check-your-email screen,
with `Send me a new link` and `Use a different email` available, and a human to
hand over to. Nothing in the spec, and nothing an assistant could do through
the accessibility tree, gets past that screen -- that is §6's requirement, not
a gap in coverage.

## How to run it

**CI is canonical.** `.github/workflows/dpdp-app-ci.yml`'s `dpdp-app-e2e` job
(after the typecheck/lint/test/build job) installs Chromium, builds with
`VITE_MOCK=1`, runs `bunx playwright test` in `dpdp-app/`, and uploads the HTML
report as an artifact when it fails. A green run there, on the PR's head SHA,
is the evidence; a local run is a convenience.

Locally -- only with more than 2 GB of RAM free (a Chromium plus the Vite
preview server; on this project's usual 8 GB laptop that is a real
constraint, not a formality):

```sh
cd dpdp-app
bun install
bunx playwright install chromium      # once
VITE_MOCK=1 bun run build             # the spec drives dist/, not the dev server
bunx playwright test                  # or: bun run test:e2e
bunx playwright show-report           # after a failure
```

`playwright.config.ts` starts `vite preview` on `127.0.0.1:4173` itself. It
does not build: a stale or missing `dist/` is the first thing to check when
every test fails at once. No Supabase credentials are needed at any point.

`bun test` (the unit suite) never runs this file: `bunfig.toml` scopes it to
`src/`.
