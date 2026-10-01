// PROJEXA-BUILD-001 U-46b1: a fake of the database side of the ai-work-link Edge Function, for the four ai-work-link-*.test.ts files that run
// the REAL handler, MCP layer and document builders without Deno, network or database. It behaves like the public.ai_work_link_* SQL
// functions of drizzle/0624 to 0626 where the Edge Function depends on them: the coded errors (AW410, AW403, AW400), the call log with its
// two limits and its `throttled` answer before any row is written, the effective level and function list from the live role, keyset
// record pages, and (BUILD-002 WP-09a) a small ai_work_link_record_intent with idempotent replay and the two write caps. It does NOT run the real SQL (src/lib/services/ai-work-link-functions.pglite.test.ts does that); it lets a test switch a
// faulty layer on (`leaksMoney`: SQL forgets to null money, `failLog`: the call log breaks) to prove the Edge layer holds on its own.
import { configFromEnv } from "../../../../supabase/functions/ai-work-link/config"
import type { AwlConfig, Rpc, RpcResult } from "../../../../supabase/functions/ai-work-link/reads"
import REGISTRY_JSON from "../../../../supabase/functions/ai-work-link/function-registry.generated.json"
import KINDS_JSON from "../../../../supabase/functions/ai-work-link/record-kinds.generated.json"

export const F = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link"
export const tok = (c: string): string => "pxa_" + c.repeat(64)

export const TOKENS = {
  manager: tok("a"), // rank 3, level 1
  member: tok("b"), // rank 2, level 1: money hidden
  viewer: tok("c"), // rank 1
  otherProject: tok("d"), // a manager of project B
  revoked: tok("e"),
  expired: tok("f"),
  unknown: tok("9"),
  levelZero: tok("7"), // a manager whose link was made at level 0
  // links made for a PERSON (drizzle/0668): all the projects the person may read, level 0
  userManager: tok("8"), // rank 3 (not tok("1"): the throttle test of the router makes tokens from the pairs 01 to 1f, and 11 is "1" 64 times): proj_a, proj_b (public) and nothing private of someone else
  userMember: tok("2"), // rank 2: money hidden, may draft create_project
  userViewer: tok("3"), // rank 1: no create_project
  userAdmin: tok("4"), // rank 5: also the private project proj_c
  userOrgTwo: tok("5"), // a manager of organisation 2: sees proj_x only
} as const

const RANK: Record<string, number> = { viewer: 1, member: 2, manager: 3, admin: 5 }

/** The projects of the fake: proj_a and proj_b (organisation 1, public, led by the manager), proj_c (private, led by the admin) and proj_x (organisation 2). */
export type FakeProject = { id: string; name: string; org: string; private?: boolean; lead: string; status: string }
const readableBy = (l: { role: string; user_id: string; org: string }, p: FakeProject): boolean => p.org === l.org && (!p.private || RANK[l.role] >= 5 || p.lead === l.user_id)

type Reg = { function_id: string; kind: string; link_level: number | null; money_sensitive: boolean; min_role_rank: number; text_params: string[] }
type Kind = { kind: string; money_columns: string[]; filters: { omit_when_hidden?: string[] } }
const REGISTRY = REGISTRY_JSON as unknown as Reg[]
const KINDS = KINDS_JSON as unknown as Kind[]

export type FakeLink = {
  id: string
  token: string
  /** `user`: a link made for a person, with no project of its own. */
  scope?: "project" | "user"
  /** The organisation of the person (default org_1). */
  org?: string
  user_id: string
  user_name: string
  project_id: string | null
  project_name: string | null
  role: string
  authority_level: number
  allowed: string[]
  status: "active" | "revoked"
  expired?: boolean
}

export function linkFor(token: string, over: Partial<FakeLink>): FakeLink {
  const role = over.role ?? "manager"
  const rank = RANK[role]
  return {
    id: `lnk_${token.slice(4, 6)}`,
    token,
    user_id: `usr_${role}`,
    user_name: over.user_name ?? "Asha Rao",
    project_id: "proj_a",
    project_name: over.project_name ?? "Tower A fit-out",
    role,
    authority_level: 1,
    allowed: REGISTRY.filter((f) => f.link_level !== null && f.min_role_rank <= rank).map((f) => f.function_id),
    status: "active",
    ...over,
  }
}

export type FakeOptions = {
  /** SQL forgets to null money for a role below rank 3 (proves the Edge nulls it on its own). */
  leaksMoney?: boolean
  /** Rows per record kind (default 3). */
  rowsPerKind?: number
  /** Text stored in every row's `notes`. */
  notes?: string
  projectName?: string
  writesEnabled?: boolean
  /** SQL forgets to leave create_project off a link for one project (proves the Edge refuses it on its own). */
  leaksCreateProject?: boolean
}

export type FakeCall = { name: string; args: Record<string, unknown> }
export type LogRow = { link_id: string | null; prefix: string | null; at: number; path: string; status: number | null; ua: string | null }

export type FakeIntent = {
  id: string
  link_id: string
  kind: string
  function_id: string
  params: Record<string, unknown>
  key: string
  status: string
  confirm_token: string | null
  at: number
  project_id?: string | null
  user_id?: string
  /** The outcome a test sets to say the intent is done: the record it made. */
  result?: { id?: string; route?: string } | null
}

export type Fake = {
  rpc: Rpc
  projects: FakeProject[]
  calls: FakeCall[]
  logRows: LogRow[]
  intents: FakeIntent[]
  links: Map<string, FakeLink>
  state: { clock: number; failLog: null | "error" | "throw" | "shape"; leaksMoney: boolean; writesEnabled: boolean }
  names(): string[]
}

function ipPrefix(ip: unknown): string | null {
  if (typeof ip !== "string" || ip === "") return null
  if (ip === "all") return "all"
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip)
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + "::/48"
  return null
}

function rowsFor(kind: Kind, projectId: string, n: number, notes: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (let i = 1; i <= n; i++) {
    const tag = projectId.slice(-1)
    const row: Record<string, unknown> = { id: kind.kind === "project" ? projectId : `${kind.kind}-${tag}${String(i).padStart(3, "0")}`, name: `${kind.kind} ${i}`, item_code: `EX-${String(i).padStart(2, "0")}`, notes }
    for (const c of kind.money_columns) row[c] = 1000 + i + 0.5
    out.push(row)
  }
  return kind.kind === "project" ? out.slice(0, 1) : out
}

const codeErr = (code: string, message: string): RpcResult => ({ data: null, error: { code, message } })
const ok = (data: unknown): RpcResult => ({ data, error: null })

export function makeFake(opts: FakeOptions = {}): Fake {
  const links = new Map<string, FakeLink>()
  const add = (l: FakeLink) => links.set(l.token, l)
  add(linkFor(TOKENS.manager, { role: "manager", user_name: "Asha Rao", project_name: opts.projectName ?? "Tower A fit-out" }))
  add(linkFor(TOKENS.member, { role: "member", user_name: "Ravi Nair", project_name: opts.projectName ?? "Tower A fit-out" }))
  add(linkFor(TOKENS.viewer, { role: "viewer", user_name: "Meera Iyer", project_name: opts.projectName ?? "Tower A fit-out" }))
  add(linkFor(TOKENS.otherProject, { role: "manager", project_id: "proj_b", project_name: "Warehouse B shell" }))
  add(linkFor(TOKENS.revoked, { role: "manager", status: "revoked" }))
  add(linkFor(TOKENS.expired, { role: "manager", expired: true }))
  add(linkFor(TOKENS.levelZero, { role: "manager", authority_level: 0 }))
  const person = (token: string, role: string, name: string, over: Partial<FakeLink> = {}) =>
    add(linkFor(token, { role, user_name: name, scope: "user", project_id: null, project_name: null, authority_level: 0, ...over }))
  person(TOKENS.userManager, "manager", "Asha Rao")
  person(TOKENS.userMember, "member", "Ravi Nair")
  person(TOKENS.userViewer, "viewer", "Meera Iyer")
  person(TOKENS.userAdmin, "admin", "Ada Admin", { user_id: "usr_admin" })
  person(TOKENS.userOrgTwo, "manager", "Xavier Org Two", { user_id: "usr_x", org: "org_2" })
  const PROJECTS: FakeProject[] = [
    { id: "proj_a", name: opts.projectName ?? "Tower A fit-out", org: "org_1", lead: "usr_manager", status: "active" },
    { id: "proj_b", name: "Warehouse B shell", org: "org_1", lead: "usr_manager", status: "planning" },
    { id: "proj_c", name: "Private C", org: "org_1", private: true, lead: "usr_admin", status: "active" },
    { id: "proj_x", name: "Other org tower", org: "org_2", lead: "usr_x", status: "active" },
  ]

  const state: Fake["state"] = { clock: 1_800_000_000_000, failLog: null, leaksMoney: opts.leaksMoney ?? false, writesEnabled: opts.writesEnabled ?? false }
  const calls: FakeCall[] = []
  const logRows: LogRow[] = []
  const n = opts.rowsPerKind ?? 3
  const notes = opts.notes ?? "site note"
  const data = new Map<string, Map<string, Array<Record<string, unknown>>>>()
  for (const projectId of ["proj_a", "proj_b", "proj_c", "proj_x"]) {
    const byKind = new Map<string, Array<Record<string, unknown>>>()
    for (const k of KINDS) byKind.set(k.kind, rowsFor(k, projectId, n, notes))
    data.set(projectId, byKind)
  }

  const live = (l: FakeLink | undefined): l is FakeLink => !!l && l.status === "active" && !l.expired

  /** `bound`: a link made for a person that has chosen a project (create_project is for a person with none, every other function for one with a project). */
  function effective(l: FakeLink, bound = false) {
    const rank = RANK[l.role]
    const level = !state.writesEnabled || rank < 2 ? 0 : l.authority_level
    const base = REGISTRY.filter((f) => f.link_level !== null && l.allowed.includes(f.function_id) && f.min_role_rank <= rank).map((f) => f.function_id).sort()
    const fns = l.scope === "user" && !bound ? base.filter((f) => f === "create_project") : opts.leaksCreateProject ? base : base.filter((f) => f !== "create_project")
    return { rank, level, fns }
  }

  const orgOf = (l: FakeLink) => l.org ?? "org_1"

  function resolve(token: string, project: FakeProject | null = null): Record<string, unknown> {
    const l = links.get(token)
    if (!live(l)) return { status: "gone" }
    const e = effective(l, project !== null)
    return {
      status: "ok", link_id: l.id, scope: l.scope ?? "project", org_id: orgOf(l), user_id: l.user_id, user_name: l.user_name,
      project_id: project ? project.id : l.project_id, project_name: project ? project.name : l.project_name,
      live_role: l.role, live_rank: e.rank, authority_level: l.authority_level, allowed_functions: l.allowed, effective_level: e.level, effective_functions: e.fns,
      money_visible: e.rank >= 3, hide_personal: true, label: null, expires_at: "2026-10-02T00:00:00Z", writes_enabled: state.writesEnabled,
    }
  }

  /** The project of a call: a person's link binds the named project (404 when the person may not read it, whatever the reason), a project link is its own. */
  function projectOf(l: FakeLink, projectId: unknown, needProject: boolean): { project: FakeProject | null } | RpcResult {
    if (l.scope === "user") {
      if (projectId === undefined || projectId === null) return needProject ? codeErr("AW400", "PROJECT_REQUIRED") : { project: null }
      const p = PROJECTS.find((x) => x.id === projectId)
      return p && readableBy({ role: l.role, user_id: l.user_id, org: orgOf(l) }, p) ? { project: p } : codeErr("AW404", "PROJECT_NOT_FOUND")
    }
    if (projectId !== undefined && projectId !== null && projectId !== l.project_id) return codeErr("AW404", "PROJECT_NOT_FOUND")
    return { project: PROJECTS.find((x) => x.id === l.project_id) ?? null }
  }

  const need = (token: string): FakeLink | RpcResult => {
    const l = links.get(String(token))
    return live(l) ? l : codeErr("AW410", "This link has expired or was revoked")
  }

  function logCall(a: Record<string, unknown>): RpcResult {
    if (state.failLog === "throw") throw new Error("connection reset")
    if (state.failLog === "error") return { data: null, error: { code: "53300", message: "too many connections" } }
    if (state.failLog === "shape") return ok({ hello: "world" })
    const token = String(a.p_token)
    if (!/^pxa_[0-9a-f]{64}$/.test(token)) return ok({ status: "malformed" })
    const l = links.get(token)
    const isLive = live(l)
    const prefix = ipPrefix(a.p_ip_prefix)
    const win = logRows.filter((r) => r.at > state.clock - 60_000)
    if (isLive) {
      const recent = win.filter((r) => r.link_id === l!.id).length
      if (recent >= 120) return ok({ status: "throttled", scope: "link", calls_last_minute: recent, limit_per_minute: 120 })
    } else {
      const recent = win.filter((r) => r.link_id === null && r.prefix === prefix).length
      if (recent >= 30) return ok({ status: "throttled", scope: "address", calls_last_minute: recent, limit_per_minute: 30 })
    }
    const recent = isLive ? win.filter((r) => r.link_id === l!.id).length : win.filter((r) => r.link_id === null && r.prefix === prefix).length
    logRows.push({ link_id: isLive ? l!.id : null, prefix, at: state.clock, path: String(a.p_path), status: null, ua: (a.p_ua_family as string | null) ?? null })
    return ok({ status: isLive ? "ok" : l ? "gone" : "unknown", call_id: `call_${logRows.length}`, link_id: isLive ? l!.id : null, calls_last_minute: recent + 1, limit_per_minute: isLive ? 120 : 30 })
  }

  function hiddenFor(l: FakeLink, kind: Kind): string[] {
    return effective(l).rank >= 3 ? [] : kind.money_columns
  }

  function records(a: Record<string, unknown>, one: string | null): RpcResult {
    const l = need(String(a.p_token))
    if ("error" in l) return l
    const where = projectOf(l, a.p_project_id, true)
    if ("error" in where) return where
    const projectId = where.project?.id ?? ""
    const kind = KINDS.find((k) => k.kind === a.p_kind)
    if (!kind) return codeErr("AW400", "UNKNOWN_KIND")
    const filters = (a.p_filters ?? {}) as Record<string, string>
    const hidden = hiddenFor(l, kind)
    for (const key of Object.keys(filters)) {
      const field = key === "sort" ? filters[key].replace(/^-/, "") : key.replace(/_(eq|gt|lt|in)$/, "")
      if (hidden.includes(field) && !state.leaksMoney) return codeErr("AW403", "HIDDEN_FIELD")
    }
    const all = (data.get(projectId)?.get(kind.kind) ?? []).slice()
    let rows = all
    if (one !== null) rows = all.filter((r) => r.id === one)
    const after = typeof a.p_after === "string" ? a.p_after : null
    if (after) rows = rows.filter((r) => String(r.id) > after)
    const limit = Math.min(Math.max(Number(a.p_limit ?? 50), 1), 200)
    const page = rows.slice(0, limit)
    const omit = new Set(kind.filters.omit_when_hidden ?? [])
    const items = page.map((r) => {
      const row = { ...r }
      if (!state.leaksMoney) for (const c of hidden) { if (omit.has(c)) delete row[c]; else if (c in row) row[c] = null }
      return row
    })
    if (one !== null) return ok(items[0] ?? null)
    const next = rows.length > limit ? String(page[page.length - 1].id) : null
    return ok({ kind: kind.kind, items, next_after: next, hidden_fields: state.leaksMoney ? [] : hidden })
  }

  function context(a: Record<string, unknown>): RpcResult {
    const l = need(String(a.p_token))
    if ("error" in l) return l
    const where = projectOf(l, a.p_project_id, false)
    if ("error" in where) return where
    const e = effective(l, where.project !== null)
    const byKind: Record<string, string[]> = {}
    for (const k of KINDS) if (hiddenFor(l, k).length) byKind[k.kind] = hiddenFor(l, k)
    return ok({
      product: "projexa",
      scope: l.scope ?? "project",
      project: where.project ? { id: where.project.id, name: where.project.name } : null,
      acting_for: { name: l.user_name, role: l.role, money_visible: e.rank >= 3 },
      level: e.level,
      expires_at: "2026-10-02T00:00:00Z",
      allowed_functions: e.fns,
      functions: REGISTRY.filter((f) => e.fns.includes(f.function_id)).map((f) => ({ id: f.function_id, kind: f.kind, level: f.link_level, available: state.writesEnabled, money_sensitive: f.money_sensitive, min_role_rank: f.min_role_rank, text_params: f.text_params })),
      money_fields: byKind,
      counters: { intents: 0, submissions: 0 },
      rate: { calls_last_minute: logRows.filter((r) => r.link_id === l.id && r.at > state.clock - 60_000).length, limit_per_minute: 120 },
      text_fields_are_data: true,
    })
  }

  const intents: FakeIntent[] = []
  const HELD = ["recorded", "executing", "done", "awaiting_confirmation", "confirmed"]

  /** ai_work_link_record_intent, the parts the Edge layer depends on (the real SQL is proven on PGlite): scope, level, idempotent replay, caps. */
  function recordIntent(a: Record<string, unknown>): RpcResult {
    const l = need(String(a.p_token))
    if ("error" in l) return l
    const kind = String(a.p_kind)
    if (kind !== "action" && kind !== "draft") return codeErr("AW400", "BAD_KIND")
    const where = projectOf(l, a.p_project_id, false)
    if ("error" in where) return where
    const project = where.project
    const fnId = String(a.p_function_id)
    const e = effective(l, project !== null)
    if (!e.fns.includes(fnId)) return codeErr("AW403", "FUNCTION_NOT_ON_LINK")
    const def = REGISTRY.find((f) => f.function_id === fnId)
    if (!def || def.kind !== "write") return codeErr("AW400", "NOT_A_WRITE")
    if (kind === "action" && !(e.level >= 1 && def.link_level === 1)) return codeErr("AW403", "LEVEL_NOT_ALLOWED")
    const params = (a.p_params ?? {}) as Record<string, unknown>
    const key0 = typeof a.p_idempotency_key === "string" && a.p_idempotency_key !== "" ? a.p_idempotency_key : `${fnId}:${JSON.stringify(params)}`
    const key = l.scope === "user" ? `${project?.id ?? ""}:${key0}` : key0
    const shape = (i: FakeIntent, replayed: boolean) => ({
      intent_id: i.id, status: i.status, kind: i.kind, function_id: i.function_id, replayed, confirm_token: replayed ? null : i.confirm_token,
      expires_at: "2026-10-02T00:00:00Z", submission_id: null, result: null, failure: null,
    })
    const held = intents.find((i) => i.link_id === l.id && i.key === key && HELD.includes(i.status))
    if (held) return ok(shape(held, true))
    if (fnId === "create_project" && intents.filter((i) => i.user_id === l.user_id && i.function_id === "create_project" && i.at > state.clock - 86_400_000).length >= 5) return codeErr("AW429", "PROJECT_CAP_DAY")
    const mine = intents.filter((i) => i.link_id === l.id)
    if (mine.filter((i) => i.at > state.clock - 3_600_000).length >= 30) return codeErr("AW429", "WRITE_CAP_HOUR")
    if (mine.filter((i) => i.at > state.clock - 86_400_000).length >= 200) return codeErr("AW429", "WRITE_CAP_DAY")
    const made: FakeIntent = {
      id: `int_${intents.length + 2}`, link_id: l.id, kind, function_id: fnId, params, key,
      status: kind === "draft" ? "awaiting_confirmation" : "recorded", confirm_token: kind === "draft" ? "c".repeat(64) : null, at: state.clock,
      project_id: project?.id ?? null, user_id: l.user_id, result: null,
    }
    intents.push(made)
    return ok(shape(made, false))
  }

  const rpc: Rpc = async (name, args = {}) => {
    calls.push({ name, args })
    switch (name) {
      case "ai_work_link_record_intent":
        return recordIntent(args)
      case "ai_work_link_log_call":
        return logCall(args)
      case "ai_work_link_log_call_result": {
        const row = logRows[Number(String(args.p_call_id).replace("call_", "")) - 1]
        if (row) row.status = Number(args.p_status)
        return ok({ ok: !!row })
      }
      case "ai_work_link__resolve":
        return ok(resolve(String(args.p_token)))
      case "ai_work_link__resolve_in": {
        const l = links.get(String(args.p_token))
        if (!live(l)) return ok({ status: "gone" })
        const where = projectOf(l, args.p_project_id, true)
        return "error" in where ? where : ok(resolve(String(args.p_token), where.project))
      }
      case "ai_work_link_projects": {
        const l = need(String(args.p_token))
        if ("error" in l) return l
        if (l.scope !== "user") return codeErr("AW403", "USER_LINK_REQUIRED")
        const rank = RANK[l.role]
        const limit = Math.min(Math.max(Number(args.p_limit ?? 100), 1), 100)
        const mine = PROJECTS.filter((p) => readableBy({ role: l.role, user_id: l.user_id, org: orgOf(l) }, p))
        const shown = mine.slice(0, limit)
        const rows = shown.map((p, i) => ({
          id: p.id, name: p.name, status: p.status, is_active: true, lead: p.lead === l.user_id, health_status: null, progress_percent: 10 * (i + 1), start_date: null, target_date: "2026-12-31",
          project_value: rank >= 3 || state.leaksMoney ? 1000000 + i : null, tasks_total: 4 + i, tasks_open: 3 + i, tasks_overdue: i, boq_lines: 10 * (i + 1),
        }))
        return ok({ projects: rows, total: mine.length, shown: rows.length, truncated: mine.length > rows.length, money_hidden: rank < 3 })
      }
      case "ai_work_link_context":
        return context(args)
      case "ai_work_link_records":
        return records(args, null)
      case "ai_work_link_record":
        return records({ ...args, p_after: null, p_limit: 1, p_filters: {} }, String(args.p_id))
      case "ai_work_link_history": {
        const l = need(String(args.p_token))
        return "error" in l ? l : ok({ items: [{ intent_id: "int_1", kind: "draft", function_id: "create_meeting", status: "awaiting_confirmation" }] })
      }
      case "ai_work_link_intent_status": {
        const l = need(String(args.p_token))
        if ("error" in l) return l
        const made = intents.find((i) => i.id === args.p_intent_id && i.link_id === l.id)
        if (made) return ok({ intent_id: made.id, kind: made.kind, function_id: made.function_id, status: made.status, result: made.result ?? null })
        return ok(args.p_intent_id === "int_1" ? { intent_id: "int_1", kind: "draft", status: "awaiting_confirmation" } : null)
      }
      default:
        return { data: null, error: { message: `unexpected rpc ${name}` } }
    }
  }

  return { rpc, projects: PROJECTS, calls, logRows, intents, links, state, names: () => calls.map((c) => c.name) }
}

/**
 * The settings a test runs with: the defaults of config.ts, plus a realistic confirm host. The exec function is OFF unless a test says `execPresent: true`,
 * whatever the deployed constant is (true since the switch-on, 2026-09-27): the tests that mean "with the executor" ask for it.
 */
export function testConfig(over: Partial<AwlConfig> = {}): AwlConfig {
  return { ...configFromEnv(() => undefined), confirmHost: "inbox-test.pages.dev", execPresent: false, ...over }
}

export function url(path: string): string {
  return `${F}${path}`
}

export function req(path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Request {
  const body = init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body)
  return new Request(url(path), { method: init.method ?? "GET", headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) }, body })
}

/** The manifest block of a manual, parsed exactly as the conformance harness does. */
export function manifestOf(markdown: string): Record<string, any> {
  const m = /```json ai-link-manifest[ \t]*\r?\n([\s\S]*?)\r?\n```/.exec(markdown)
  if (!m) throw new Error("no manifest block")
  return JSON.parse(m[1])
}

export const PRIVATE_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "access-control-allow-origin": "*",
}
