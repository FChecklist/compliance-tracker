// Supabase Auth "Send Email" hook for the shared project (2026-11-07). WHY: on 7 Nov the one Resend account that carries DPDP sign-in mail
// hit its daily cap ("550 You have reached your daily email sending quota") because another product on the same account (Corporate Tambola's
// midnight deletion-notice job and smoke games) sent 263 mails in the first hour of the day -- nobody could sign in. This hook sends every auth
// mail through Resend first and, on ANY failure, through Cloudflare Email Service (included in Workers Paid, 3,000 a month), so one provider's
// quota can no longer lock people out.
//
// PURE like _shared/mail-outbound.ts: fetch, environment and clock are injected so bun tests can run it. index.ts wires Deno.
//
// The magic-link template is the SAME file as supabase/auth-templates/magic-link.html (a test keeps the two byte-identical). It is a Go
// template; only the constructs that file uses are supported (one if/else/end on RedirectTo, and {{ .Var }} substitutions).
// Every other mail type gets a plain, safe message with the action link. The hook is NOT enabled by deploying this function: it is switched
// on by an explicit owner action in Authentication > Hooks, so deploying it changes nothing for anyone.

export interface HookDeps {
  env: (k: string) => string
  fetch: typeof fetch
  now: () => number
  magicHtml: string
  magicSubject: string
}
type Json = Record<string, unknown>
type Msg = { subject: string; html: string }

const b64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const toB64 = (u: Uint8Array): string => btoa(String.fromCharCode(...u))

/** Standard Webhooks check (what Supabase signs hooks with): v1,<base64 HMAC-SHA256 of "id.timestamp.body"> with the base64 key after "whsec_". */
export async function verifySignature(secret: string, headers: Headers, body: string, nowSec: number): Promise<boolean> {
  const id = headers.get("webhook-id"), ts = headers.get("webhook-timestamp"), sig = headers.get("webhook-signature")
  if (!id || !ts || !sig || !secret) return false
  if (Math.abs(nowSec - Number(ts)) > 300) return false
  const key = await crypto.subtle.importKey("raw", b64(secret.replace(/^v1,/, "").replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const mac = toB64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`))))
  return sig.split(" ").some((p) => p.startsWith("v1,") && timingSafeEqual(p.slice(3), mac))
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Renders the project's Go template for the constructs it uses. Variables are Supabase's own URLs and tokens, escaped for HTML. */
export function renderGoTemplate(tpl: string, vars: Record<string, string>): string {
  let t = tpl.replace(/\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}\s*/g, "")
  t = t.replace(/\{\{-?\s*if([\s\S]*?)-?\}\}([\s\S]*?)\{\{-?\s*else\s*-?\}\}([\s\S]*?)\{\{-?\s*end\s*-?\}\}/, (_m, cond: string, yes: string, no: string) => {
    const wanted = [...cond.matchAll(/"([^"]*)"/g)].map((x) => x[1])
    return wanted.includes(vars.RedirectTo ?? "") ? yes : no
  })
  return t.replace(/\{\{\s*\.(\w+)\s*\}\}/g, (_m, name: string) => esc(vars[name] ?? "")).trim()
}

export function buildMessage(d: HookDeps, user: { email: string }, ed: Json): Msg {
  const supa = d.env("SUPABASE_URL")
  const token = String(ed.token ?? ""), tokenHash = String(ed.token_hash ?? ""), type = String(ed.email_action_type ?? "")
  const redirect = String(ed.redirect_to ?? ""), site = String(ed.site_url ?? "")
  const confirmationURL = `${supa}/auth/v1/verify?token=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(type)}&redirect_to=${encodeURIComponent(redirect)}`
  const vars = { Token: token, TokenHash: tokenHash, ConfirmationURL: confirmationURL, RedirectTo: redirect, SiteURL: site, Email: user.email }
  if (type === "magiclink") return { subject: renderGoTemplate(d.magicSubject, vars).replace(/\s+/g, " "), html: renderGoTemplate(d.magicHtml, vars) }
  const titles: Record<string, string> = { signup: "Confirm your sign-up", recovery: "Reset your access", invite: "You have been invited", email_change: "Confirm your new e-mail", reauthentication: "Your confirmation code" }
  const title = titles[type] ?? "Your sign-in link"
  const html = type === "reauthentication"
    ? `<p>${esc(title)}: <b>${esc(token)}</b></p>`
    : `<p>${esc(title)}. This link expires shortly and works once.</p><p><a href="${esc(confirmationURL)}">Continue</a></p><p>Did not ask for this? Ignore this e-mail.</p>`
  return { subject: title, html }
}

async function viaResend(d: HookDeps, m: Msg, to: string, from: string): Promise<{ ok: boolean; why: string }> {
  const key = d.env("RESEND_API_KEY")
  if (!key) return { ok: false, why: "no RESEND_API_KEY" }
  try {
    const r = await d.fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ from, to: [to], subject: m.subject, html: m.html }), signal: AbortSignal.timeout(8000) })
    return r.ok ? { ok: true, why: "resend" } : { ok: false, why: `resend ${r.status}` }
  } catch (e) { return { ok: false, why: `resend error ${(e as Error).name}` } }
}

async function viaCloudflare(d: HookDeps, m: Msg, to: string, from: string): Promise<{ ok: boolean; why: string }> {
  const tok = d.env("CLOUDFLARE_EMAIL_TOKEN"), acct = d.env("CLOUDFLARE_ACCOUNT_ID")
  if (!tok || !acct) return { ok: false, why: "cloudflare not configured" }
  try {
    const r = await d.fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/email/sending/send`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ from, to, subject: m.subject, html: m.html }), signal: AbortSignal.timeout(8000) })
    return r.ok ? { ok: true, why: "cloudflare" } : { ok: false, why: `cloudflare ${r.status}` }
  } catch (e) { return { ok: false, why: `cloudflare error ${(e as Error).name}` } }
}

export async function handleSendEmail(req: Request, d: HookDeps): Promise<Response> {
  const body = await req.text()
  if (!(await verifySignature(d.env("SEND_EMAIL_HOOK_SECRET"), req.headers, body, Math.floor(d.now() / 1000)))) return new Response("bad signature", { status: 401 })
  let p: { user?: { email?: string }; email_data?: Json }
  try { p = JSON.parse(body) } catch { return new Response("bad body", { status: 400 }) }
  const to = p.user?.email
  if (!to || !p.email_data) return new Response("bad payload", { status: 400 })
  const from = d.env("DPDP_AUTH_EMAIL_FROM") || "VERIDIAN AI DPDP <dpdp@veridian-aios.com>"
  const m = buildMessage(d, { email: to }, p.email_data)
  const a = await viaResend(d, m, to, from)
  if (a.ok) return Response.json({})
  const b = await viaCloudflare(d, m, to, from)
  if (b.ok) { console.log(`auth mail sent via cloudflare after: ${a.why}`); return Response.json({}) }
  console.error(`auth mail failed: ${a.why}; ${b.why}`)
  return Response.json({ error: { http_code: 500, message: "Could not send the sign-in e-mail" } }, { status: 500 })
}
