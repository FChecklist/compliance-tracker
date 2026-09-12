import { test, expect, type APIRequestContext } from "@playwright/test";

// R-40 ("Record partial progress against a weighted sub-task") -- one of
// the six requirements previously citing e2e/demo-gate-smoke.spec.ts, per
// PM instruction to de-share that citation. Extracts TC-30's real assertion
// chain (create a weighted BOQ, record a real work-progress entry against
// its sub-task, confirm the weighted-rollup earned value/percent) into its
// own committed, distinct, re-runnable spec against Env-1. Not a new
// behavioural check -- the same real API calls, same expected figures
// (750 earned value, 15% by value) already proven against Env-1.
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

test("R-40: recording partial progress against a weighted sub-task rolls up correctly", async ({ browser, request }) => {
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

  // Parent (qty 100 x rate 50 = 5000) + Frame 01 sub-task (30% weight,
  // qty 100 x rate 15 = 1500 weighted value) -- same fixture shape as
  // demo-gate-smoke.spec.ts's TC-30.
  const boqRes = await apiRequest.post("/api/scope", {
    data: {
      projectId: oakwood.id,
      title: `R-40 env1 spec ${Date.now()}`,
      lineItems: [
        { itemCode: "P1", description: "Parent", unit: "m2", quantity: 100, rate: 50 },
        { itemCode: "F01", parentItemCode: "P1", breakdownPercentage: 30, description: "Frame 01", unit: "m2", quantity: 100, rate: 15 },
      ],
    },
  });
  expect(boqRes.status(), "a valid weighted BOQ must be created").toBe(201);
  const boq = await boqRes.json();
  const frame01 = boq.lineItems.find((li: { itemCode: string }) => li.itemCode === "F01");
  expect(frame01, "the F01 sub-task line item must exist on the created BOQ").toBeTruthy();

  const activityRes = await apiRequest.post("/api/work-progress/activities", {
    data: { projectId: oakwood.id, name: `R-40 env1 spec activity ${Date.now()}` },
  });
  expect(activityRes.status(), "a valid work-progress activity must be created").toBe(201);
  const activity = await activityRes.json();

  const progressRes = await apiRequest.post("/api/work-progress", {
    data: {
      projectId: oakwood.id,
      activityId: activity.id,
      boqLineItemId: frame01.id,
      entryDate: new Date().toISOString().slice(0, 10),
      quantityDone: 50, // 50% of Frame 01's own 100 m2 scope
      percentComplete: 50,
    },
  });
  expect(progressRes.status(), "R-40: a partial progress entry against a weighted sub-task must be recorded (201)").toBe(201);

  const reportRes = await apiRequest.get(
    `/api/work-progress/report?projectId=${oakwood.id}&from=2026-01-01&to=2026-12-31&boqId=${boq.id}`
  );
  expect(reportRes.ok()).toBeTruthy();
  const wpr = await reportRes.json();
  const parentRow = wpr.rows.find((r: { code: string }) => r.code === "P1");
  expect(parentRow, "the parent's weighted-rollup row must exist in the report").toBeTruthy();
  expect(parentRow.amt.current, "R-40: earned value must be 750 (1,500 weighted value x 50% done)").toBe(750);
  expect(parentRow.percentage.current, "R-40: project percent by value must be 15").toBe(15);

  // D58 falsifiability note (not yet run, see PR description): planting a
  // defect means temporarily using the sub-task's OWN rate (15) instead of
  // its weighted share of the parent's value in the rollup calc and
  // confirming this assertion goes red, then reverting.
});
