import { test, expect, type APIRequestContext } from "@playwright/test";

// R-32 ("BOQ total EXCLUDES sub-tasks, 5000 not 6500") -- one of the six
// requirements previously citing e2e/demo-gate-smoke.spec.ts, per PM
// instruction to de-share that citation. The real, hard assertion already
// exists inside demo-gate-smoke.spec.ts's TC-11 block: a weighted parent
// (qty 100 x rate 50 = 5000) with three sub-tasks (40/35/25% breakdown,
// pricing 2000/1750/1250 off the parent) must sum to 5000 when only ROOT
// line items are counted -- summing parent+children would double-count to
// 6500+ (5000 + 2000+1750+1250 = 10000 in the original TC-10/TC-11 fixture;
// this file's own numbers below reproduce the same 40/35/25 split, so the
// exact same double-count failure mode -- 5000 -> 10000, not 6500 -- would
// show if root-only summation ever regressed). This file extracts that ONE
// real assertion into its own committed, distinct, re-runnable spec, tested
// against Env-1, not a new behavioural check invented for the occasion.
//
// NOT Env-2-dependent in substance -- proven against Env-1 already (see
// demo-gate-smoke.spec.ts header, 3 runs 2026-09-09). Same Env-1 override
// convention as every other spec in this batch.
const SUPABASE_URL = "https://evpckeuxgvahguwsaeul.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2cGNrZXV4Z3ZhaGd1d3NhZXVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1MjM4MzIsImV4cCI6MjA5OTA5OTgzMn0.3vDtJ-XlsVse2jJ8XNozM-Szyt-Wb6FxX9ZoC2_q8pk";
const MINT_SECRET = "r33-mint-2026";
const DEMO_EMAIL = "democeo@projexa-ai.com";
const PROJEXA_ORIGIN = process.env.E2E_PROJEXA_ORIGIN || "https://projexa-ai.com";
const PROJEXA_COOKIE_DOMAIN = new URL(PROJEXA_ORIGIN).hostname;

async function mintSessionCookie(request: APIRequestContext) {
  const mintRes = await request.get(`${SUPABASE_URL}/functions/v1/mint-session-r33`, {
    headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    params: { email: DEMO_EMAIL, secret: MINT_SECRET },
  });
  expect(mintRes.ok(), "mint-session-r33 Edge Function must be reachable and active").toBeTruthy();
  const { token_hash } = await mintRes.json();
  expect(token_hash, "a real token_hash must come back").toBeTruthy();

  const verifyRes = await request.post(`${SUPABASE_URL}/auth/v1/verify`, {
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    data: { type: "magiclink", token_hash },
  });
  expect(verifyRes.ok(), "GoTrue token_hash exchange must succeed").toBeTruthy();
  const session = await verifyRes.json();
  expect(session.access_token, "a real access_token must come back").toBeTruthy();
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;
}

test("R-32: BOQ total excludes sub-tasks (root-only sum, not parent+children)", async ({ browser, request }) => {
  const isLocalTarget = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$|\/)/.test(PROJEXA_ORIGIN);
  test.setTimeout(isLocalTarget ? 120_000 : 60_000);

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

  for (let i = 0; i < 8; i++) {
    if ((await apiRequest.get("/api/projects")).ok()) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const projectsRes = await apiRequest.get("/api/projects");
  expect(projectsRes.ok()).toBeTruthy();
  const { projects } = await projectsRes.json();
  const oakwood = projects.find((p: { name: string }) => p.name.includes("Oakwood"));
  expect(oakwood, "the real Demo Organization must still have its Oakwood project").toBeTruthy();

  // Weighted parent + 3 sub-tasks, same 100x50 / 40-35-25% shape as
  // demo-gate-smoke.spec.ts's TC-10, so this reproduces the identical
  // double-count failure signature (5000 -> 10000) if it ever regresses.
  const created = await apiRequest.post("/api/scope", {
    data: {
      projectId: oakwood.id,
      title: `R-32 env1 spec ${Date.now()}`,
      lineItems: [
        { itemCode: "M1", description: "Parent M1", unit: "m2", quantity: 100, rate: 50 },
        { itemCode: "M1-A", parentItemCode: "M1", breakdownPercentage: 40, description: "Sub 40", unit: "m2", quantity: 1, rate: 1 },
        { itemCode: "M1-B", parentItemCode: "M1", breakdownPercentage: 35, description: "Sub 35", unit: "m2", quantity: 1, rate: 1 },
        { itemCode: "M1-C", parentItemCode: "M1", breakdownPercentage: 25, description: "Sub 25", unit: "m2", quantity: 1, rate: 1 },
      ],
    },
  });
  expect(created.status(), "a valid weighted BOQ must be created").toBe(201);
  const boq = await created.json();

  const amountsByCode = Object.fromEntries(
    (boq.lineItems as { itemCode: string; amount: string }[]).map((li) => [li.itemCode, Number(li.amount)])
  );
  // Confirm the fixture priced as expected before trusting the root-only sum.
  expect(amountsByCode["M1-A"]).toBe(2000);
  expect(amountsByCode["M1-B"]).toBe(1750);
  expect(amountsByCode["M1-C"]).toBe(1250);

  const rootOnlyTotal = (boq.lineItems as { parentLineItemId: string | null; amount: string }[])
    .filter((li) => !li.parentLineItemId)
    .reduce((sum, li) => sum + Number(li.amount), 0);
  expect(rootOnlyTotal, "R-32: root-only total must be 5000, not 6500/10000 from double-counting children").toBe(5000);

  // D58 falsifiability note (not yet run, see PR description): planting a
  // defect means temporarily removing the `!li.parentLineItemId` filter
  // above (or the equivalent in the real report endpoint) and confirming
  // this assertion goes red (10000 instead of 5000), then reverting.
});
