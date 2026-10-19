import { expect, type APIRequestContext } from "@playwright/test";

// Shared test-login for the Env-1 specs (replaces four copy-pasted
// mintSessionCookie functions). Zero-password: obtains a one-time token_hash for
// the demo account, then exchanges it at GoTrue for a real session.
//
// DIAGNOSIS (2026-10-19, G-4): the HTTP 401 these specs got was NOT the gateway
// rejecting the legacy anon JWT -- that JWT passes (verified live). It is
// mint-session-r33's OWN `{"error":"unauthorized"}`: its MINT_SECRET was rotated
// server-side, so the old published literal no longer matches. Nothing about the
// API-key scheme is wrong, and the function's check is correct, so neither is
// changed. Two routes, in this order:
//   1. MINT_SECRET set (CI)            -> the mint-session-r33 Edge Function.
//   2. else PROJEXA_SUPABASE_SERVICE_ROLE_KEY set (local run) -> the Supabase
//      admin generateLink API directly, for the single demo address only.
// The Supabase URL and the public (anon/publishable) key are read from the
// environment; nothing secret is hard-coded or printed.

const SUPABASE_URL = process.env.PROJEXA_SUPABASE_URL ?? "https://evpckeuxgvahguwsaeul.supabase.co";
const DEMO_EMAIL = "democeo@projexa-ai.com";

function publicKey(): string {
  const key = process.env.PROJEXA_SUPABASE_PUBLIC_KEY ?? process.env.PROJEXA_SUPABASE_ANON_KEY ?? "";
  if (!key) {
    throw new Error(
      "PROJEXA_SUPABASE_PUBLIC_KEY (the PROJEXA project's anon or sb_publishable_ key; public, not a secret) is required for the test login",
    );
  }
  return key;
}

async function tokenHash(request: APIRequestContext): Promise<string> {
  const mintSecret = process.env.MINT_SECRET;
  if (mintSecret) {
    const res = await request.get(`${SUPABASE_URL}/functions/v1/mint-session-r33`, {
      headers: { Authorization: `Bearer ${publicKey()}`, apikey: publicKey() },
      params: { email: DEMO_EMAIL, secret: mintSecret },
    });
    expect(res.ok(), "mint-session-r33 must accept MINT_SECRET (a 401 'unauthorized' means the secret is stale)").toBeTruthy();
    const { token_hash } = await res.json();
    expect(token_hash, "a real token_hash must come back").toBeTruthy();
    return token_hash;
  }
  const serviceKey = process.env.PROJEXA_SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error("Set MINT_SECRET (CI) or PROJEXA_SUPABASE_SERVICE_ROLE_KEY (local run) to obtain a test login");
  }
  const res = await request.post(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    data: { type: "magiclink", email: DEMO_EMAIL },
  });
  expect(res.ok(), "admin generate_link must succeed for the demo account").toBeTruthy();
  const body = await res.json();
  expect(body.hashed_token, "a real hashed_token must come back").toBeTruthy();
  return body.hashed_token;
}

export async function mintSessionCookie(request: APIRequestContext): Promise<string> {
  const token_hash = await tokenHash(request);
  const verifyRes = await request.post(`${SUPABASE_URL}/auth/v1/verify`, {
    headers: { apikey: publicKey(), "Content-Type": "application/json" },
    data: { type: "magiclink", token_hash },
  });
  expect(verifyRes.ok(), "GoTrue token_hash exchange must succeed").toBeTruthy();
  const session = await verifyRes.json();
  expect(session.access_token, "a real access_token must come back").toBeTruthy();
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;
}
