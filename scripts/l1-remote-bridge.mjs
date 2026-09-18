#!/usr/bin/env bun
// L1 remote bridge (2026-09-18, owner-directed). Run this ON THE OWNER'S OWN
// LAPTOP, where the `claude` CLI is installed and authenticated via the
// owner's own Claude Code subscription. Front it with a Cloudflare Tunnel so
// Vercel (which cannot spawn a local binary) can reach it, and it will shell
// out to `claude -p` locally and return the result -- the exact same
// mechanism src/lib/ai/providers/claude-cli.ts already uses for local dev,
// just reachable over HTTP. See src/lib/ai/providers/claude-cli-remote.ts
// for the server-side caller and the licensing reasoning (this bridge is
// gated to the owner's own identity there, not here -- this script has no
// idea who the request is ultimately for, by design; the identity gate lives
// entirely in adapter.ts on the Vercel side, unconditionally, before any
// request reaches this file at all).
//
// THIS SCRIPT DOES NOT KNOW OR CARE which pipeline level is calling it -- it
// exposes exactly one operation ("run this system+user prompt through my
// local claude CLI and return strict JSON"), and claude-cli-remote.ts is the
// only thing that constructs the prompts, in exactly the same shapes
// providers/claude-cli.ts already sends locally.
//
// Usage:
//   BRIDGE_SECRET=<a long random string, shared with CLAUDE_CLI_REMOTE_SECRET
//     in Vercel> bun scripts/l1-remote-bridge.mjs
// Then, in a second terminal:
//   cloudflared tunnel --url http://localhost:8787
// Copy the printed https://*.trycloudflare.com URL into Vercel's
// CLAUDE_CLI_REMOTE_URL for compliance-tracker Production.
//
// Keep this terminal (and the tunnel) open for the whole time production
// traffic might use L1/L2 with AI_PROVIDER(_PIPELINE_L1)=claude-cli-remote.
// Closing either one makes every such request fail with a clear "could not
// reach the bridge" error (see claude-cli-remote.ts) -- it degrades to a
// loud failure, never a silent wrong answer.
import { spawn } from "node:child_process";

const PORT = Number(process.env.BRIDGE_PORT ?? 8787);
const SECRET = process.env.BRIDGE_SECRET;
if (!SECRET) {
  console.error("BRIDGE_SECRET is not set. Refusing to start: an unauthenticated bridge would be a public, unauthenticated path to this machine's own claude CLI the moment the tunnel URL is known.");
  process.exit(1);
}

const CLAUDE_CLI_TIMEOUT_MS = 60_000;

function stripJsonFence(content) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

// Identical shape to providers/claude-cli.ts's runClaudeCli() -- see that
// file's own comment for why shell:true + stdin (not argv) is required on
// Windows.
function runClaudeCli(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p"], { stdio: ["pipe", "pipe", "pipe"], shell: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude CLI timed out after ${CLAUDE_CLI_TIMEOUT_MS}ms`));
    }, CLAUDE_CLI_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to launch the claude CLI (${err.message}). Is Claude Code installed and on PATH on this machine?`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude CLI exited with code ${code}: ${stderr.slice(0, 2000)}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "l1-remote-bridge" });
    }
    if (req.method !== "POST" || url.pathname !== "/run") {
      return new Response("Not found", { status: 404 });
    }
    const providedSecret = req.headers.get("x-bridge-secret") ?? "";
    if (!timingSafeEqual(providedSecret, SECRET)) {
      console.warn(`[l1-remote-bridge] rejected request with a bad/missing x-bridge-secret from ${req.headers.get("cf-connecting-ip") ?? "unknown"}`);
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ ok: false, error: "body must be JSON" }, { status: 400 });
    }
    const { systemPrompt, userMessage, expectedKeys } = body ?? {};
    if (typeof systemPrompt !== "string" || typeof userMessage !== "string" || !Array.isArray(expectedKeys)) {
      return Response.json({ ok: false, error: "expected { systemPrompt: string, userMessage: string, expectedKeys: string[] }" }, { status: 400 });
    }

    const prompt = `${systemPrompt}\n\n---\n\nRespond with ONLY the JSON object described above, no other text, no markdown code fence.\n\n${userMessage}`;
    console.log(`[l1-remote-bridge] running a prompt (${prompt.length} chars) through the local claude CLI...`);
    try {
      const raw = await runClaudeCli(prompt);
      const parsed = JSON.parse(stripJsonFence(raw.trim()));
      const missing = expectedKeys.filter((key) => !(parsed && typeof parsed === "object" && key in parsed));
      if (missing.length > 0) {
        return Response.json({ ok: false, error: `claude CLI response is missing expected key(s): ${missing.join(", ")}` }, { status: 502 });
      }
      console.log("[l1-remote-bridge] OK");
      return Response.json({ ok: true, data: parsed });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[l1-remote-bridge] FAILED: ${message}`);
      return Response.json({ ok: false, error: message }, { status: 502 });
    }
  },
});

console.log(`[l1-remote-bridge] listening on http://localhost:${server.port}`);
console.log(`[l1-remote-bridge] next: in another terminal, run: cloudflared tunnel --url http://localhost:${server.port}`);
console.log("[l1-remote-bridge] keep this process and the tunnel running for as long as production may route L1/L2 here.");
