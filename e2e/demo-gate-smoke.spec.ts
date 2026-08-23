import { test, expect, type APIRequestContext } from "@playwright/test";

// R38/R-B1 (Master v5 WO-11): ONE Playwright script over the demo gate's own
// TCs (TC-01, TC-10, TC-11, TC-30, TC-40) -- a real regression guard over a
// path this session already proved by hand, live, twice, against real
// production (compliance-tracker PRs #1326/#1328/#1330, projexa PRs
// #94/#96). Deliberately ONE test, not a suite -- per WO-11's own text,
// its job is to protect a path already proven, not to re-litigate it.
//
// Runs against real production (projexa-ai.com / compliance-tracker's
// deployed API), the same live system every TC in this session was actually
// verified against -- not a mock, not a local dev server (which would need
// its own Supabase credentials wired into CI, a separate and larger task).
//
// Known, accepted tradeoff: each run creates 3 real, timestamped BOQs on
// Oakwood and never deletes them -- there is no DELETE endpoint for a BOQ
// (confirmed absent this session), and this repo's own protocol forbids
// writing to production via raw SQL to make a test pass/clean up (P-11).
// Test data accretes on a real demo project across CI runs; titles are
// timestamped and clearly test-marked ("R-B1 smoke ...") so they're always
// identifiable for a periodic manual sweep, same posture this session's own
// live-evidence-gathering already required (see this PR's own history).
//
// Auth: the SAME zero-password session-minting mechanism this entire work
// order used throughout (mint-session-r33 Edge Function -> GoTrue token_hash
// exchange -> a real session cookie), via Playwright's `request` API context
// rather than `page` for the two auth HTTP calls, then injected into the
// browser context. No password is ever typed or stored. The anon/publishable
// key below is Supabase's public, client-embeddable key (same one already
// baked into projexa's own shipped JS bundle) -- not a secret.
const SUPABASE_URL = "https://evpckeuxgvahguwsaeul.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2cGNrZXV4Z3ZhaGd1d3NhZXVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1MjM4MzIsImV4cCI6MjA5OTA5OTgzMn0.3vDtJ-XlsVse2jJ8XNozM-Szyt-Wb6FxX9ZoC2_q8pk";
const MINT_SECRET = "r33-mint-2026";
const DEMO_EMAIL = "democeo@projexa-ai.com";
const PROJEXA_ORIGIN = "https://projexa-ai.com";

async function mintSessionCookie(request: APIRequestContext) {
  const mintRes = await request.get(
    `${SUPABASE_URL}/functions/v1/mint-session-r33`,
    {
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      params: { email: DEMO_EMAIL, secret: MINT_SECRET },
    }
  );
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

test("demo gate: TC-01, TC-10, TC-11, TC-30, TC-40 all hold against real production", async ({
  browser,
  request,
}) => {
  test.setTimeout(60_000);

  const cookieValue = await mintSessionCookie(request);
  const context = await browser.newContext({ baseURL: PROJEXA_ORIGIN });
  await context.addCookies([
    {
      name: "sb-evpckeuxgvahguwsaeul-auth-token",
      value: cookieValue,
      domain: "projexa-ai.com",
      path: "/",
    },
  ]);
  const page = await context.newPage();
  const apiRequest = context.request;

  // Confirm the minted session actually resolves to a real, authenticated
  // org -- fails loudly here rather than producing confusing downstream
  // 401s if auth silently didn't take.
  const orgRes = await apiRequest.get("/api/organization");
  expect(orgRes.ok(), "the minted session must resolve to a real org").toBeTruthy();
  const org = await orgRes.json();
  expect(org.email).toBe(DEMO_EMAIL);

  const projectsRes = await apiRequest.get("/api/projects");
  expect(projectsRes.ok()).toBeTruthy();
  const { projects } = await projectsRes.json();
  const oakwood = projects.find((p: { name: string }) => p.name.includes("Oakwood"));
  expect(oakwood, "the real Demo Organization must still have its Oakwood project").toBeTruthy();

  // TC-01: BOQ appears; amount 5,000; status draft.
  const tc01 = await apiRequest.post("/api/scope", {
    data: {
      projectId: oakwood.id,
      title: `R-B1 smoke ${Date.now()}`,
      lineItems: [{ description: "Partition Wall", unit: "m2", quantity: 100, rate: 50 }],
    },
  });
  expect(tc01.status(), "TC-01: a valid BOQ must be created").toBe(201);
  const tc01Boq = await tc01.json();
  expect(tc01Boq.status).toBe("draft");
  expect(Number(tc01Boq.lineItems[0].amount)).toBe(5000);

  // TC-10: weighted sub-tasks (40/35/25%) price off the parent -> 2000/1750/1250.
  const tc10 = await apiRequest.post("/api/scope", {
    data: {
      projectId: oakwood.id,
      title: `R-B1 smoke TC-10 ${Date.now()}`,
      lineItems: [
        { itemCode: "M1", description: "Parent M1", unit: "m2", quantity: 100, rate: 50 },
        { itemCode: "M1-A", parentItemCode: "M1", breakdownPercentage: 40, description: "Sub 40", unit: "m2", quantity: 1, rate: 1 },
        { itemCode: "M1-B", parentItemCode: "M1", breakdownPercentage: 35, description: "Sub 35", unit: "m2", quantity: 1, rate: 1 },
        { itemCode: "M1-C", parentItemCode: "M1", breakdownPercentage: 25, description: "Sub 25", unit: "m2", quantity: 1, rate: 1 },
      ],
    },
  });
  expect(tc10.status(), "TC-10: a valid weighted BOQ must be created").toBe(201);
  const tc10Boq = await tc10.json();
  const amountsByCode = Object.fromEntries(
    tc10Boq.lineItems.map((li: { itemCode: string; amount: string }) => [li.itemCode, Number(li.amount)])
  );
  expect(amountsByCode["M1-A"]).toBe(2000);
  expect(amountsByCode["M1-B"]).toBe(1750);
  expect(amountsByCode["M1-C"]).toBe(1250);

  // TC-11: project total is the PARENT-only sum (5,000), never 10,000
  // (double-counting parent + children) -- the real R-33 bug this session
  // found and fixed (PR compliance-tracker#1328).
  const tc11 = await apiRequest.get(`/api/reports/scope?projectId=${oakwood.id}`);
  expect(tc11.ok(), "TC-11: the scope report must resolve").toBeTruthy();
  const scopeReport = await tc11.json();
  expect(scopeReport.boq.id).toBe(tc10Boq.id); // the just-created BOQ must be recognized as latest
  expect(scopeReport.totalValue).toBe(5000);

  // TC-40: the dashboard's per-project Value derives from that same active
  // BOQ's root-only total -- the real R-50 feature this session built (PR
  // compliance-tracker#1330 + projexa#96).
  const dashboardProjectsRes = await apiRequest.get("/api/projects");
  expect(dashboardProjectsRes.ok()).toBeTruthy();
  const { projects: refreshedProjects } = await dashboardProjectsRes.json();
  const oakwoodRefreshed = refreshedProjects.find((p: { id: string }) => p.id === oakwood.id);
  expect(oakwoodRefreshed.value, "TC-40: the dashboard value must match the active BOQ's total").toBe(5000);

  // TC-30: record real progress against a weighted sub-task (Frame 01, 30%
  // of a 5,000 parent) and confirm the weighted-rollup earned value/percent.
  const tc30Boq = await apiRequest.post("/api/scope", {
    data: {
      projectId: oakwood.id,
      title: `R-B1 smoke TC-30 ${Date.now()}`,
      lineItems: [
        { itemCode: "P1", description: "Parent", unit: "m2", quantity: 100, rate: 50 },
        { itemCode: "F01", parentItemCode: "P1", breakdownPercentage: 30, description: "Frame 01", unit: "m2", quantity: 100, rate: 15 },
      ],
    },
  });
  expect(tc30Boq.status()).toBe(201);
  const tc30BoqBody = await tc30Boq.json();
  const frame01 = tc30BoqBody.lineItems.find((li: { itemCode: string }) => li.itemCode === "F01");

  const activityRes = await apiRequest.post("/api/work-progress/activities", {
    data: { projectId: oakwood.id, name: `R-B1 smoke activity ${Date.now()}` },
  });
  expect(activityRes.status()).toBe(201);
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
  expect(progressRes.status()).toBe(201);

  const reportRes = await apiRequest.get(
    `/api/work-progress/report?projectId=${oakwood.id}&from=2026-01-01&to=2026-12-31`
  );
  expect(reportRes.ok()).toBeTruthy();
  const wpr = await reportRes.json();
  const parentRow = wpr.rows.find((r: { code: string }) => r.code === "P1");
  expect(parentRow.amt.current, "TC-30: earned value must be 750 (1,500 weighted value x 50%)").toBe(750);
  expect(parentRow.percentage.current, "TC-30: project percent by value must be 15").toBe(15);

  // One real browser render, proving the browser install this job depends
  // on genuinely matters here (not just an API-testing script that happens
  // to use Playwright's request fixture) -- the live dashboard shows a real
  // AED-formatted, non-lakh-grouped figure (TC-90, PR projexa#95) for a
  // project this test itself just gave a value to.
  await page.goto("/dashboard");
  await expect(page.getByText("AED 5,000", { exact: false })).toBeVisible({ timeout: 15_000 });

  await context.close();
});
