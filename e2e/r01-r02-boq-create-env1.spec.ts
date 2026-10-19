import { test, expect, type APIRequestContext } from "@playwright/test";
import { mintSessionCookie } from "./support/mint-session";

// R-01 ("BOQ saves without server error") and R-02 ("Line item amount = QTY x
// RATE") -- two of the six requirements previously citing
// e2e/demo-gate-smoke.spec.ts as their closure_test_path, per PM instruction
// to de-share that citation (kt/DECISIONS.PM.jsonl, over-shared-citation
// component). Both requirements' real assertions already exist inside
// demo-gate-smoke.spec.ts's TC-01 block (a single POST /api/scope call,
// checked for a 201 status AND a correct qty*rate line-item amount) -- this
// file does NOT invent a new behavioural check, it extracts the SAME two
// real assertions into their own committed, distinct, re-runnable spec, so
// each requirement cites something specific to it rather than a 6-way-shared
// file that CI no longer even runs (W-CI's DOD-X4 testIgnore excludes
// demo-gate-smoke.spec.ts from CI entirely as of tonight).
//
// NOT Env-2-dependent in substance -- demo-gate-smoke.spec.ts's own header
// already proves this exact call sequence passes against Env-1 (3 runs,
// 2026-09-09). Env-2 is this file's default only by the same
// PROJEXA_ORIGIN convention every spec in this suite uses, overridden to
// Env-1 in CI exactly like r60-boq-currency-env1.spec.ts.
//
// Auth: same zero-password mint-session-r33 mechanism as
// demo-gate-smoke.spec.ts (this file is API-level, like that one, not
// UI-level like the projexa-repo r60 spec -- kept consistent with the
// spec it is extracted from rather than switched to a different suite's
// convention).
// 2026-09-30: MINT_SECRET was rotated server-side (see demo-gate-smoke-env1
// .spec.ts's own comment on this same line for the full story) -- read the
// real value from CI's env var, falling back to the pre-rotation literal
// only for a local run with no env var configured.
const PROJEXA_ORIGIN = process.env.E2E_PROJEXA_ORIGIN || "https://projexa-ai.com";
const PROJEXA_COOKIE_DOMAIN = new URL(PROJEXA_ORIGIN).hostname;

let createdBoqId: string | null = null;

test("R-01 / R-02: creating a BOQ with a real line item succeeds (201) and prices QTY x RATE correctly", async ({
  browser,
  request,
}) => {
  const isLocalTarget = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$|\/)/.test(PROJEXA_ORIGIN);
  test.setTimeout(isLocalTarget ? 120_000 : 60_000);

  // Availability probe, same convention as demo-gate-smoke.spec.ts: SKIP
  // (not fail) if unreachable. A skip is not a pass.
  let unreachable: string | null = null;
  let status: number | null = null;
  try {
    const probe = await request.get(PROJEXA_ORIGIN, { failOnStatusCode: false, timeout: 20_000 });
    status = probe.status();
  } catch (err) {
    unreachable = err instanceof Error ? err.message : String(err);
  }
  test.skip(unreachable !== null || status === 503, `${PROJEXA_ORIGIN} is not serving -- skipping, not passing.`);

  const cookieValue = await mintSessionCookie(request);
  const context = await browser.newContext({ baseURL: PROJEXA_ORIGIN });
  await context.addCookies([
    { name: "sb-evpckeuxgvahguwsaeul-auth-token", value: cookieValue, domain: PROJEXA_COOKIE_DOMAIN, path: "/" },
  ]);
  const apiRequest = context.request;

  const orgRes = await apiRequest.get("/api/organization");
  expect(orgRes.ok(), "the minted session must resolve to a real org").toBeTruthy();

  // Same KD-15 cold-compile warm-up demo-gate-smoke.spec.ts needs on Env-1.
  for (let i = 0; i < 8; i++) {
    if ((await apiRequest.get("/api/projects")).ok()) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const projectsRes = await apiRequest.get("/api/projects");
  expect(projectsRes.ok()).toBeTruthy();
  const { projects } = await projectsRes.json();
  const oakwood = projects.find((p: { name: string }) => p.name.includes("Oakwood"));
  expect(oakwood, "the real Demo Organization must still have its Oakwood project").toBeTruthy();

  const created = await apiRequest.post("/api/scope", {
    data: {
      projectId: oakwood.id,
      title: `R-01-R-02 env1 spec ${Date.now()}`,
      lineItems: [{ description: "Partition Wall", unit: "m2", quantity: 100, rate: 50 }],
    },
  });

  // R-01: the create call itself must not server-error.
  expect(created.status(), "R-01: a valid BOQ create request must return 201, not a 4xx/5xx server error").toBe(201);
  const boq = await created.json();
  createdBoqId = boq.id;

  // R-02: the persisted line item's amount must equal quantity x rate
  // (100 x 50 = 5000), read back from the real response, not computed
  // client-side and compared to itself.
  expect(Number(boq.lineItems[0].amount), "R-02: line item amount must equal quantity x rate").toBe(5000);

  // D58 falsifiability note (not yet run, see PR description): planting a
  // defect here means temporarily changing erp-budget-service.ts or
  // construction-boq-service.ts's amount calc to qty+rate instead of
  // qty*rate and confirming this assertion goes red (5000 expected vs 150
  // actual), then reverting -- the same RED/GREEN pattern already used for
  // DOD-X4/DOD-R3/R-60 tonight.
});

test.afterEach(async () => {
  // R46/E-126b precedent: this spec creates one real, timestamped BOQ per
  // run on the shared demo project. No DELETE cleanup is wired here yet
  // (unlike demo-gate-smoke.spec.ts's own afterEach) -- disclosed limitation,
  // not an oversight; titles are tagged "R-01-R-02 env1 spec <ts>" so a
  // future cleanup sweep can identify and remove them by prefix.
  createdBoqId = null;
});
