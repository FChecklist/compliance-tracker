// Visitor-journey tracking -- where did the visit come from? PURE. Input is what the browser reports (the referrer HOST only -- never a path or a query -- and the UTM
// parameters), output is the source kind + the names the report groups by.

export type SourceKind = "direct" | "search" | "social" | "referral" | "campaign" | "internal" | "email"
export type Utm = { source: string | null; medium: string | null; campaign: string | null; term: string | null; content: string | null }
export type Source = { kind: SourceKind; referrerHost: string | null; searchEngine: string | null; utm: Utm }

const SEARCH: Array<[RegExp, string]> = [
  [/(^|\.)google\.[a-z.]+$/, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)yahoo\.[a-z.]+$/, "Yahoo"],
  [/(^|\.)yandex\.[a-z.]+$/, "Yandex"],
  [/(^|\.)baidu\.com$/, "Baidu"],
  [/(^|\.)ecosia\.org$/, "Ecosia"],
  [/(^|\.)search\.brave\.com$/, "Brave"],
  [/(^|\.)startpage\.com$/, "Startpage"],
  [/(^|\.)perplexity\.ai$/, "Perplexity"],
  [/(^|\.)(chatgpt\.com|chat\.openai\.com)$/, "ChatGPT"],
  [/(^|\.)(claude\.ai)$/, "Claude"],
  [/(^|\.)(gemini\.google\.com)$/, "Gemini"],
  [/(^|\.)copilot\.microsoft\.com$/, "Copilot"],
]
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|instagram\.com|linkedin\.com|lnkd\.in|twitter\.com|x\.com|t\.co|youtube\.com|youtu\.be|whatsapp\.com|wa\.me|reddit\.com|t\.me|telegram\.org|quora\.com|medium\.com)$/
const OWN = /(^|\.)veridian-aios\.com$|(^|\.)veridian-dpdp-app\.pages\.dev$/

/** A UTM value as kept: lower case, plain characters only, at most 80 long, never anything containing an "@" (an address pasted into a campaign tag is dropped, not stored). */
export function cleanUtm(v: unknown): string | null {
  if (typeof v !== "string") return null
  const s = v.trim().toLowerCase().slice(0, 80)
  if (!s || s.includes("@") || !/^[a-z0-9 _.+:/|-]+$/.test(s) || /[a-z0-9_-]{24,}/.test(s)) return null
  return s
}

/** The host of a referrer, lower case, no port; null for anything that is not a plain host name. */
export function cleanHost(v: unknown): string | null {
  if (typeof v !== "string") return null
  const h = v.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0]!.replace(/:\d+$/, "")
  return /^[a-z0-9]([a-z0-9.-]{0,118}[a-z0-9])?$/.test(h) && h.includes(".") ? h : null
}

export function classifySource(input: { referrerHost?: unknown; utm?: Partial<Record<keyof Utm, unknown>> | null }): Source {
  const u = input.utm ?? {}
  const utm: Utm = { source: cleanUtm(u.source), medium: cleanUtm(u.medium), campaign: cleanUtm(u.campaign), term: cleanUtm(u.term), content: cleanUtm(u.content) }
  const host = cleanHost(input.referrerHost)
  const engine = host ? (SEARCH.find(([re]) => re.test(host))?.[1] ?? null) : null
  const tagged = !!(utm.source || utm.medium || utm.campaign)
  if (utm.medium && /^(e-?mail|newsletter)$/.test(utm.medium)) return { kind: "email", referrerHost: host, searchEngine: engine, utm }
  if (tagged) return { kind: "campaign", referrerHost: host, searchEngine: engine, utm }
  if (!host) return { kind: "direct", referrerHost: null, searchEngine: null, utm }
  if (OWN.test(host)) return { kind: "internal", referrerHost: host, searchEngine: null, utm }
  if (engine) return { kind: "search", referrerHost: host, searchEngine: engine, utm }
  if (SOCIAL.test(host)) return { kind: "social", referrerHost: host, searchEngine: null, utm }
  return { kind: "referral", referrerHost: host, searchEngine: null, utm }
}
