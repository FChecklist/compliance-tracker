// PROJEXA-BUILD-002 WP-14 (register rows AW-603, AW-701 to AW-703): the pieces the persona scenarios share.
//   * startHost():   the local execution host in dry mode with the persona world (scripts/awl-local-exec-host.ts --dry --seed persona) as a child process;
//   * Ai:            the EXTERNAL AI. It holds one link address and speaks plain HTTP to it and to nothing else: no host route, no session, no database.
//                    Everything an AI may do is in the link's own manual, so this class has no method the manual does not describe.
//   * Person:        the signed-in person on the app routes (mint, confirm, revoke) with a local session bearer. The confirm goes through the same
//                    routes the static confirm page calls: preview first, then confirm, with the code taken from the fragment of the confirm address.
//   * Verifier:      reads what was PERSISTED (the business tables of the world and the intent rows) through the host's read-only dry routes.
//   * Transcript:    every request and answer, with tokens and confirm codes cut to their first six characters, written as markdown.
// Nothing here prints a secret: the host's local secret is generated per run and never written anywhere.
/// <reference types="bun-types" />
import { randomBytes } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export type Json = Record<string, any>

/** Tokens, confirm codes and session bearers are shown by their first six characters. */
export function redact(text: string): string {
  return text
    .replace(/pxa_[0-9a-f]{64}/g, (m) => `${m.slice(0, 6)}…`)
    .replace(/(#d=[A-Za-z0-9_-]+\.)([0-9a-f]{20,})/g, (_m, a, b) => `${a}${String(b).slice(0, 6)}…`)
    .replace(/dry-session-[a-z]+-[a-z0-9]+/g, (m) => `${m.slice(0, 6)}…`)
    .replace(/"confirmToken":"[^"]+"/g, (m) => `"confirmToken":"${m.slice(16, 22)}…"`)
}

export class Transcript {
  private lines: string[] = []
  private n = 0
  constructor(private title: string, private intro: string[]) {}
  section(text: string) {
    this.lines.push("", `## ${text}`, "")
  }
  note(text: string) {
    this.lines.push(text, "")
  }
  step(who: string, method: string, path: string, reqBody: unknown, status: number, resBody: unknown) {
    this.n++
    const cut = (v: unknown, max: number) => {
      // a refusal is shown by its stable code and what is missing first, then the sentence
      const shown =
        v && typeof v === "object" && !Array.isArray(v) && "error" in (v as Json)
          ? { code: (v as Json).code, missing: (v as Json).missing, error: (v as Json).error, hint: (v as Json).hint }
          : v
      // one line per request: a manual or a record holds line breaks that would read as markdown headings
      const s = (typeof shown === "string" ? shown : JSON.stringify(shown)).replace(/\s*[\r\n]+\s*/g, " / ")
      return redact(s.length > max ? `${s.slice(0, max)} …(${s.length} chars)` : s)
    }
    this.lines.push(`**${this.n}. ${who}: \`${method} ${redact(path)}\`**`)
    if (reqBody !== undefined && reqBody !== null) this.lines.push(`- sent: \`${cut(reqBody, 420)}\``)
    this.lines.push(`- answer: **${status}** \`${cut(resBody, 520)}\``, "")
  }
  check(ok: boolean, label: string) {
    this.lines.push(`- ${ok ? "PASS" : "FAIL"}: ${label}`)
  }
  write(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, [`# ${this.title}`, "", ...this.intro, ...this.lines, ""].join("\n"), "utf8")
  }
}

export class Checks {
  failed: string[] = []
  passed = 0
  constructor(private transcript?: Transcript) {}
  ok(cond: boolean, label: string): boolean {
    this.transcript?.check(cond, label)
    if (cond) this.passed++
    else {
      this.failed.push(label)
      console.error(`FAIL ${label}`)
    }
    return cond
  }
  eq(actual: unknown, expected: unknown, label: string): boolean {
    const same = JSON.stringify(actual) === JSON.stringify(expected)
    return this.ok(same, same ? label : `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`)
  }
}

export type Host = { origin: string; secret: string; base: string; stop: () => void; auth: Record<string, string>; log: () => string }

/** Starts the local execution host in dry mode with the persona world and waits until it answers. */
export async function startHost(seed: "persona" | "persona-empty" = "persona"): Promise<Host> {
  const port = 8800 + Math.floor(Math.random() * 190)
  const secret = randomBytes(24).toString("hex")
  const origin = `http://127.0.0.1:${port}`
  const proc = Bun.spawn([process.execPath, "run", "scripts/awl-local-exec-host.ts", "--dry", "--seed", seed, "--port", String(port)], {
    env: { ...process.env, AWL_EXEC_INTERNAL_SECRET: secret },
    stdout: "ignore",
    stderr: "pipe",
  })
  const auth = { authorization: `Bearer ${secret}` }
  // the host's own stderr (the exec function logs a failed run there, closed codes only leave it): kept for the run's failure report
  let hostLog = ""
  void (async () => {
    const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader()
    const dec = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hostLog = (hostLog + dec.decode(value)).slice(-20_000)
    }
  })()
  const deadline = Date.now() + 180_000
  for (;;) {
    if (Date.now() > deadline) {
      proc.kill()
      throw new Error("the local execution host did not start in 180 seconds")
    }
    try {
      const r = await fetch(`${origin}/functions/v1/ai-work-link-exec/health`, { headers: auth })
      if (r.status === 200) break
    } catch {
      // not up yet
    }
    if (proc.exitCode !== null) throw new Error(`the local execution host exited with ${proc.exitCode}: ${hostLog.slice(0, 600)}`)
    await new Promise((res) => setTimeout(res, 500))
  }
  return { origin, secret, auth, base: `${origin}/functions/v1/ai-work-link`, stop: () => proc.kill(), log: () => hostLog }
}

const JSON_HEADERS = { "content-type": "application/json" }

async function call(method: string, url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Json; text: string }> {
  const res = await fetch(url, { method, headers: { ...(body !== undefined ? JSON_HEADERS : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json: Json = {}
  try {
    json = JSON.parse(text) as Json
  } catch {
    json = {}
  }
  return { status: res.status, json, text }
}

/** The external AI: one link address, plain HTTP, the link's public surface only. */
export class Ai {
  constructor(private link: string, private transcript: Transcript, public name = "AI") {}
  private async go(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    let r = await call(method, `${this.link}${path}`, body, headers)
    // an AI that is told to wait (429 and Retry-After) waits and sends the same request again, once
    if (r.status === 429) {
      this.transcript.step(this.name, method, path, body, r.status, r.json)
      this.transcript.note("(the AI waits 61 seconds, as the answer says, and sends the same request again)")
      await new Promise((res) => setTimeout(res, 61_000))
      r = await call(method, `${this.link}${path}`, body, headers)
    }
    this.transcript.step(this.name, method, path, body, r.status, r.json && Object.keys(r.json).length ? r.json : r.text)
    return r
  }
  /** The address of this link (for the parts of a run that hold the link on purpose, e.g. to revoke it). */
  get address(): string {
    return this.link
  }
  get(path: string) {
    return this.go("GET", path, undefined, { accept: "application/json" })
  }
  getText(path: string) {
    return this.go("GET", path, undefined, { accept: "text/markdown" })
  }
  post(path: string, body: unknown) {
    return this.go("POST", path, body)
  }
  /** GET /records/{kind}, following `next_after` to the end. */
  async records(kind: string, limit = 50): Promise<Json[]> {
    const out: Json[] = []
    let after: string | null = null
    for (let page = 0; page < 40; page++) {
      const r = await this.get(`/records/${kind}?format=json&limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`)
      if (r.status !== 200) throw new Error(`records/${kind} answered ${r.status}`)
      out.push(...(r.json.items as Json[]))
      after = (r.json.next_after as string | null) ?? null
      if (!after) break
    }
    return out
  }
  action(fn: string, params: Json, key?: string) {
    return this.post("/actions", { function: fn, params, ...(key ? { idempotency_key: key } : {}) })
  }
  draft(fn: string, params: Json, key?: string) {
    return this.post("/drafts", { function: fn, params, ...(key ? { idempotency_key: key } : {}) })
  }
}

/** The signed-in person on the app routes of the same function, with a local session. */
export class Person {
  private calls = 0
  constructor(private host: Host, private transcript: Transcript, private session: string, public label: string) {}
  /** The confirm routes brake one person at 10 calls a minute. A person who confirms a batch pauses a minute (the run moves the local clock, it does not sleep). */
  private async pace(): Promise<void> {
    if (this.calls >= 8) {
      await call("POST", `${this.host.origin}/dry/advance`, { ms: 61_000 }, this.host.auth)
      this.transcript.note(`(${this.label} pauses a minute before the next confirm: 10 confirm calls a minute is the limit)`)
      this.calls = 0
    }
    this.calls++
  }
  private async go(method: string, path: string, body?: unknown) {
    if (/\/drafts\//.test(path)) await this.pace()
    const r = await call(method, `${this.host.base}${path}`, body, { authorization: `Bearer ${this.session}` })
    this.transcript.step(`${this.label} (signed in)`, method, path, body, r.status, r.json && Object.keys(r.json).length ? r.json : r.text)
    return r
  }
  async mint(projectId: string, level: 0 | 1, label: string, functions?: string[]): Promise<{ status: number; link: string | null; json: Json }> {
    const r = await this.go("POST", "/mint", { projectId, level, days: 7, label, ...(functions ? { functions } : {}) })
    return { status: r.status, link: (r.json.links?.link as string | undefined) ?? null, json: r.json }
  }
  /** "New project with my AI": a shell project and a level-0 link for the same person, in one action. */
  async newProject(): Promise<{ status: number; link: string | null; projectId: string | null; json: Json }> {
    const r = await this.go("POST", "/new-project", { days: 7 })
    return { status: r.status, link: (r.json.links?.link as string | undefined) ?? null, projectId: (r.json.project?.id as string | undefined) ?? null, json: r.json }
  }
  links(project?: string) {
    return this.go("GET", `/links${project ? `?project=${encodeURIComponent(project)}` : ""}`)
  }
  revoke(linkId: string) {
    return this.go("POST", `/links/${linkId}/revoke`, {})
  }
  /** What the static confirm page does: read the fragment of the confirm address, show the draft (preview), then confirm with the code. */
  async confirmFromUrl(confirmUrl: string, opts: { preview?: boolean } = {}): Promise<{ preview: Json | null; status: number; json: Json }> {
    const m = /#d=([A-Za-z0-9_-]+)\.([0-9a-f]+)$/.exec(confirmUrl)
    if (!m) throw new Error("no draft and code in the confirm address")
    const [, id, code] = m
    let preview: Json | null = null
    if (opts.preview !== false) {
      const p = await this.go("POST", `/drafts/${id}/preview`, { confirmToken: code })
      preview = p.status === 200 ? p.json : null
    }
    const r = await this.go("POST", `/drafts/${id}/confirm`, { confirmToken: code })
    return { preview, status: r.status, json: r.json }
  }
}

/** Reads what was persisted, through the host's read-only dry routes. */
export class Verifier {
  constructor(private host: Host) {}
  async state(): Promise<{ intents: Json[]; tables: Record<string, Json[]> }> {
    const r = await fetch(`${this.host.origin}/dry/state`, { headers: this.host.auth })
    return (await r.json()) as { intents: Json[]; tables: Record<string, Json[]> }
  }
  async table(name: string): Promise<Json[]> {
    return (await this.state()).tables[name] ?? []
  }
  async ids(): Promise<Json> {
    return (await (await fetch(`${this.host.origin}/dry/ids`, { headers: this.host.auth })).json()) as Json
  }
  async links(): Promise<Json[]> {
    return ((await (await fetch(`${this.host.origin}/dry/links`, { headers: this.host.auth })).json()) as { links: Json[] }).links
  }
  async roles(): Promise<Record<string, string>> {
    return (await (await fetch(`${this.host.origin}/dry/roles`, { headers: this.host.auth })).json()) as Record<string, string>
  }
  async session(who: string): Promise<string> {
    return ((await call("POST", `${this.host.origin}/dry/session`, { who }, this.host.auth)).json.session as string) ?? ""
  }
  async setRole(who: string, role: string): Promise<void> {
    await call("POST", `${this.host.origin}/dry/role`, { who, role }, this.host.auth)
  }
  async advance(ms: number): Promise<void> {
    await call("POST", `${this.host.origin}/dry/advance`, { ms }, this.host.auth)
  }
  async writes(on: boolean): Promise<void> {
    await call("POST", `${this.host.origin}/dry/writes`, { on }, this.host.auth)
  }
}

export const linkIdOf = (mintJson: Json): string => String(mintJson.link_id ?? "")

/** A short deterministic idempotency key for a step. */
export const key = (s: string): string => `persona-${s}`
