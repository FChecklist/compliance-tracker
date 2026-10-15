// AUDIT-100 B58: slow or failed calls to the AI work link are visible to us. Every request writes ONE log line, `[awl-timing] {...}`, with
// the route SHAPE (never the token or an id), the status and how long the handler took. Nothing else leaves the function: no query string,
// no header, no body. A call that took 3 s or more, or answered 5xx, is marked `slow` / `failed` so one filter finds the old ~21 second
// stalls and any new ones: in the Supabase dashboard (or the query_logs tool) search the function's logs for `[awl-timing]` and `"slow":true`.
//
// Pure (no Deno global): index.ts passes `console.log`. A logging failure never changes the answer.

export const SLOW_MS = 3000;

/** `/functions/v1/ai-work-link/pxa_abc123/projects/8f14e45f-ceea-467a-9ab1-0a5b1c2d3e4f/actions` -> `/:token/projects/:id/actions`. */
export function routeShape(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  const at = parts.indexOf("ai-work-link");
  const rest = at >= 0 ? parts.slice(at + 1) : parts;
  const shaped = rest.map((seg, i) => {
    if (seg.startsWith("pxa_") || (i === 0 && seg.length >= 20)) return ":token";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) || /^[a-z0-9_-]{20,}$/i.test(seg)) return ":id";
    return seg.slice(0, 40);
  });
  return `/${shaped.join("/")}`;
}

export type TimingLine = { route: string; method: string; status: number; ms: number; slow: boolean; failed: boolean };

export function timingLine(req: { method: string; url: string }, status: number, ms: number): TimingLine {
  let route = "/";
  try { route = routeShape(new URL(req.url).pathname); } catch { /* an unreadable URL is logged as "/" */ }
  return { route, method: req.method, status, ms: Math.round(ms), slow: ms >= SLOW_MS, failed: status >= 500 };
}

/** Runs `run`, logs one timing line, returns the same response (or rethrows the same error after logging it as a 500). */
export async function withTiming(
  req: Request,
  run: () => Promise<Response>,
  log: (line: string) => void,
  now: () => number = Date.now,
): Promise<Response> {
  const started = now();
  let status = 500;
  try {
    const res = await run();
    status = res.status;
    return res;
  } finally {
    try { log(`[awl-timing] ${JSON.stringify(timingLine(req, status, now() - started))}`); } catch { /* logging must not change the answer */ }
  }
}
