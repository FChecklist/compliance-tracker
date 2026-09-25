import { createServer, type IncomingMessage, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Test helper for the U-23 verify runners (PROJEXA-BUILD-001): a fake Supabase Management API on a loopback port, and a way to run a
// script against it. Nothing here touches the network beyond 127.0.0.1, and no real token is ever used.

export interface SeenRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

export interface FakeAnswer {
  status: number;
  /** A JSON-serialisable body (sent as JSON), or a string (sent as is). */
  body: unknown;
}

export type FakeHandler = (query: string, req: SeenRequest) => FakeAnswer;

export interface FakeMgmt {
  baseUrl: string;
  requests: SeenRequest[];
  close: () => Promise<void>;
}

/** A token that is obviously fake and matches no secret pattern; built from pieces so that no scanner flags this file. */
export const FAKE_TOKEN = "selftest-token-not-real-" + "0123456789" + "abcdef";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c.toString("utf8");
    });
    req.on("end", () => resolve(data));
  });
}

export async function startFakeMgmt(handler: FakeHandler): Promise<FakeMgmt> {
  const requests: SeenRequest[] = [];
  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    const seen: SeenRequest = { method: req.method ?? "", url: req.url ?? "", authorization: req.headers.authorization, body };
    requests.push(seen);
    let query = "";
    try {
      query = String(JSON.parse(body).query ?? "");
    } catch {
      query = "";
    }
    const answer = handler(query, seen);
    const text = typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body);
    res.writeHead(answer.status, { "Content-Type": typeof answer.body === "string" ? "text/plain" : "application/json" });
    res.end(text);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  out: string;
}

/**
 * Run a program asynchronously (the fake server lives in this process, so a blocking spawnSync would starve it).
 * The environment is the current one minus every VERIFY_*, SUPABASE_* and DATABASE_URL variable, plus `env`.
 */
export function runAsync(cmd: string, args: string[], env: Record<string, string | undefined>, opts: { cwd?: string; timeoutMs?: number } = {}): Promise<RunResult> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith("VERIFY_") || k.startsWith("SUPABASE_") || k === "DATABASE_URL" || k === "APP_RUNTIME_DATABASE_URL" || k === "GATE_ROW_TIMEOUT_SECONDS") continue;
    base[k] = v;
  }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) base[k] = v;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: base, cwd: opts.cwd ?? process.cwd(), stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 120_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(e), out: stdout + stderr + String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, out: stdout + stderr });
    });
  });
}

/** A temporary folder with an .env file that holds no token, so no real token can be found by the default locations. */
export function emptyEnvFile(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "verify-envfile-"));
  const file = join(dir, "empty.env");
  writeFileSync(file, "# no token here\nOTHER=1\n", "utf8");
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
