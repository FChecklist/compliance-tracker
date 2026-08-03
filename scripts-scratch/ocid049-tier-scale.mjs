// Scratch script for OCID-049 real testing (not part of the app itself).
// Grows one real org's live user count via the real self-service join-code
// mechanism (autoProvisionUser -> redeemJoinCodeAndProvisionUser), using the
// Supabase Admin API's createUser (email_confirm:true, zero email sent) --
// the same rate-limit-safe pattern this session's OCID-050 State C org
// creation already used, never a direct DB write.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const envPath = "/opt/veridian/repos/compliance-tracker/.env.local";
const envText = readFileSync(envPath, "utf8");
function envVar(name) {
  const m = envText.match(new RegExp(`^${name}="?([^"\n]*)"?$`, "m"));
  if (!m) throw new Error(`missing ${name}`);
  return m[1];
}

const SUPABASE_URL = envVar("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envVar("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_ROLE_KEY = envVar("SUPABASE_SERVICE_ROLE_KEY");
const APP_URL = "https://projexa-ai.com";
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`;
const STATE_FILE = new URL("./ocid049-state.json", import.meta.url);

function b64url(str) {
  return Buffer.from(str, "utf8").toString("base64url");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createAuthUser({ email, password, fullName, organisation, orgJoinCode }, attempt = 1) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        ...(organisation ? { organisation } : {}),
        ...(orgJoinCode ? { orgJoinCode } : {}),
      },
    }),
  });
  if (res.status === 429 && attempt <= 3) {
    const backoff = 2000 * attempt;
    console.warn(`  createAuthUser 429, backing off ${backoff}ms (attempt ${attempt})`);
    await sleep(backoff);
    return createAuthUser({ email, password, fullName, organisation, orgJoinCode }, attempt + 1);
  }
  const body = await res.json();
  if (!res.ok) throw new Error(`createAuthUser failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

async function passwordSignIn({ email, password }) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`signIn failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

function sessionCookieHeader(session) {
  const value = "base64-" + b64url(JSON.stringify(session));
  return `${COOKIE_NAME}=${value}`;
}

async function appFetch(path, session, opts = {}) {
  const res = await fetch(`${APP_URL}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), Cookie: sessionCookieHeader(session), "Content-Type": "application/json" },
  });
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

function loadState() {
  if (!existsSync(STATE_FILE)) throw new Error("no state file -- run `init` first");
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}
function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function addOneUser(state, index) {
  const email = `ocid049-scale-${index}-${state.stamp}@veridian-test.example`;
  await createAuthUser({ email, password: state.password, fullName: `OCID049 Scale ${index}`, orgJoinCode: state.joinCode });
  const session = await passwordSignIn({ email, password: state.password });
  const me = await appFetch("/api/me", session);
  if (me.body?.orgId !== state.orgId) {
    throw new Error(`user ${index} landed in wrong org: ${me.body?.orgId} (expected ${state.orgId})`);
  }
  return email;
}

async function realUserCount(state) {
  const founderSession = await passwordSignIn({ email: state.founderEmail, password: state.password });
  const res = await appFetch("/api/users", founderSession);
  if (!Array.isArray(res.body?.users)) throw new Error(`GET /api/users unexpected shape: ${JSON.stringify(res.body)}`);
  return { count: res.body.users.length, founderSession };
}

async function functionalHealthCheck(session, label) {
  const res = await appFetch("/api/ai/orchestrate", session, {
    method: "POST",
    body: JSON.stringify({ eventType: "item.overdue", entityId: `ocid049-${label}`, payload: {} }),
  });
  if (res.status !== 200 || !Array.isArray(res.body?.actions) || res.body.actions.length === 0) {
    throw new Error(`functional health check failed (${label}): ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function main() {
  const mode = process.argv[2];

  if (mode === "init") {
    const stamp = Date.now();
    const founderEmail = `ocid049-founder-${stamp}@veridian-test.example`;
    const password = "OCID049-test-pass-" + stamp;
    console.log("Creating founder user:", founderEmail);
    await createAuthUser({ email: founderEmail, password, fullName: "OCID049 Founder", organisation: `OCID-049 Tier Scale Test Org ${stamp}` });
    const founderSession = await passwordSignIn({ email: founderEmail, password });
    const me1 = await appFetch("/api/me", founderSession);
    if (!me1.body?.orgId) throw new Error("founder did not get provisioned into a new org");

    const jc = await appFetch("/api/join-codes", founderSession, { method: "POST", body: JSON.stringify({ role: "member", label: "ocid049-scale-test" }) });
    if (!jc.body?.code) throw new Error("join code mint failed");

    const state = { stamp, orgId: me1.body.orgId, orgName: me1.body.orgName, founderEmail, password, joinCode: jc.body.code, currentCount: 1, log: [] };
    saveState(state);
    console.log("INIT OK", JSON.stringify(state, null, 2));
    return;
  }

  if (mode === "grow") {
    const target = Number(process.argv[3]);
    const delayMs = Number(process.argv[4] || 400);
    if (!target) throw new Error("usage: grow <targetCount> [delayMs]");
    const state = loadState();
    console.log(`Growing org ${state.orgId} from ${state.currentCount} to ${target} (delay ${delayMs}ms)`);
    for (let i = state.currentCount + 1; i <= target; i++) {
      const email = await addOneUser(state, i);
      state.currentCount = i;
      saveState(state);
      console.log(`  [${i}/${target}] joined: ${email}`);
      await sleep(delayMs);
    }
    console.log("GROW OK, currentCount =", state.currentCount);
    return;
  }

  if (mode === "checkpoint") {
    const label = process.argv[3] || "checkpoint";
    const state = loadState();
    const { count, founderSession } = await realUserCount(state);
    const health = await functionalHealthCheck(founderSession, label);
    const entry = { label, at: new Date().toISOString(), realUserCount: count, targetTracked: state.currentCount, functionalHealthOk: true, sampleActions: health.actions.map((a) => a.type) };
    state.log.push(entry);
    saveState(state);
    console.log("CHECKPOINT", JSON.stringify(entry, null, 2));
    return;
  }

  throw new Error("unknown mode, use: init | grow <target> [delayMs] | checkpoint <label>");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
