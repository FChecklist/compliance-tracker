// "Unfamiliar use" alert for an AI work link (owner, 2026-10-05): when a link is used from a network (IPv4 /24, IPv6 /48) or a tool family it
// has not been used from before, the link's owner gets ONE plain e-mail -- never more than one a day per link, never for the very first use
// of a link, and never containing the link (or any link). The decision is made in the database (dpdp_ai_link_note_use, drizzle/0695);
// this file is the PURE half: how the network prefix and tool family are read, and the words of the alert. No Deno globals, no network.

/** IPv4 -> "a.b.c" (the /24); IPv6 -> its first three groups (the /48); anything else -> null. Never returns more of an address than that. */
export function clientPrefix(ip: string | null | undefined): string | null {
  const raw = (ip ?? "").trim().replace(/^\[|\]$/g, "")
  if (!raw) return null
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(raw)
  if (v4) {
    const o = v4.slice(1, 5).map(Number)
    return o.every((n) => n >= 0 && n <= 255) ? `${o[0]}.${o[1]}.${o[2]}` : null
  }
  if (!/^[0-9a-fA-F:]+$/.test(raw) || !raw.includes(":")) return null
  const halves = raw.split("::")
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(":") : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const fill = halves.length === 2 ? Math.max(0, 8 - head.length - tail.length) : 0
  const groups = [...head, ...Array(fill).fill("0"), ...tail]
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null
  return groups.slice(0, 3).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")
}

/** The tool a request came from, as a short stable family name (so a new version of the same tool is not "unfamiliar"). */
export function uaFamily(ua: string | null | undefined): string {
  const u = (ua ?? "").trim()
  if (!u) return "unknown"
  const l = u.toLowerCase()
  const known: Array<[RegExp, string]> = [
    [/claude/, "Claude"], [/chatgpt|openai/, "ChatGPT"], [/gemini|google-extended|googlebot|google-read-aloud|apis-google/, "Google"], [/deepseek/, "DeepSeek"],
    [/grok|xai/, "Grok"], [/perplexity/, "Perplexity"], [/curl\//, "curl"], [/python|aiohttp|httpx|requests/, "Python"], [/node|undici|axios|got\b/, "Node"],
    [/\bedg\//, "Edge"], [/firefox/, "Firefox"], [/chrome|chromium|crios/, "Chrome"], [/safari/, "Safari"],
  ]
  for (const [re, name] of known) if (re.test(l)) return name
  return (l.split(/[\s/;(]/)[0] || "unknown").replace(/[^a-z0-9._-]/g, "").slice(0, 30) || "unknown"
}

export type UseAlert = { alert: true; to: string; org: string | null; role: string | null; label: string | null; newNetwork: boolean; newTool: boolean; at: string }

const ROLE: Record<string, string> = { owner: "the owner", coord: "the DPDP coordinator", go: "the Grievance Officer", ca: "the CA firm", staff: "a staff member", parent: "a parent" }

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/**
 * The alert. It says what happened in everyday words, what to do if it was not them, and that this is the only one for a day. It contains NO
 * address of any kind: not the link, not the app (a person who did not expect a call goes to their own saved page, not to a link in a mail).
 */
export function alertEmail(a: UseAlert): { subject: string; text: string; html: string } {
  const org = (a.org ?? "your organisation").replace(/\s+/g, " ").slice(0, 80)
  const label = a.label ? ` "${a.label.replace(/\s+/g, " ").slice(0, 60)}"` : ""
  const what = a.newNetwork && a.newTool ? "from a place and a tool we have not seen with it before" : a.newNetwork ? "from a place we have not seen it used from before" : "by a tool we have not seen it used with before"
  const role = ROLE[a.role ?? ""] ?? "your role"
  const subject = "Your VERIDIAN AI work link was just used from somewhere new"
  const lines = [
    `Your AI work link${label} for ${org} was just used ${what}.`,
    `The AI behind a link works as you (${role}) and can do no more than that role may.`,
    "If this was you or the AI you gave the link to, there is nothing to do.",
    "If it was not, sign in to VERIDIAN in your own browser, open the AI Link page, stop that link and make a new one. A stopped link stops working on its next call.",
    "We send at most one of these a day for each link. This message contains no link on purpose. Do not forward it.",
  ]
  const text = lines.join("\n\n") + "\n"
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1C2B3A;">` +
    `<p style="background:#FEE2E2;color:#B91C1C;font-weight:700;margin:0 0 14px;padding:10px 14px;border-radius:8px;">Your AI work link was just used from somewhere new</p>` +
    lines.map((l) => `<p style="margin:0 0 12px;">${esc(l)}</p>`).join("") + `</div>`
  return { subject, text, html }
}
