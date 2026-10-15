// DPDP audit trail -- who really made this call (owner spec 2026-10-06, items 1 and 9). PURE.
//
// Three kinds of evidence, never blended (each field group carries a proof level):
//   observed  the SERVER saw it: the User-Agent header, the network address, which published address range it falls in.
//   declared  the CALLER said it (ai_model, ai_version, ai_session_id, ai_machine_id): recorded as a claim, never trusted.
//   inferred  we derived it from the other two (a vendor guessed from a model name).
// When a claim and an observation disagree (the caller says it is a Claude model, the network says OpenAI) the row carries mismatch = true with the reasons.
// This detects an honest mix-up and a careless impersonation; it cannot stop a determined one (a User-Agent is just text) -- the proof levels say so.
//
// Published address ranges: the vendors publish them, they change, and this repository does NOT hard-code a copy that would silently go stale. They are read from
// the secret DPDP_AUDIT_VENDOR_IP_RANGES (JSON { "OpenAI": ["a.b.c.d/nn", ...], ... }) which an operator refreshes from each vendor's published list. With no
// ranges configured the network proof is simply "not checked" (stated, not faked).
import { AI_FETCHERS } from "../ai-link/core.ts"

export type ProofLevel = "observed" | "declared" | "inferred" | "not_checked"

const FETCHER_VENDOR: Array<[RegExp, string]> = [
  [/^(chatgpt-user|oai-searchbot|gptbot)$/i, "OpenAI"],
  [/^claude/i, "Anthropic"],
  [/^(google|gemini)/i, "Google"],
  [/^perplexity/i, "Perplexity"],
  [/^deepseek/i, "DeepSeek"],
  [/^mistralai/i, "Mistral"],
  [/^bytespider$/i, "ByteDance"],
  [/^meta-externalagent$/i, "Meta"],
  [/^amazonbot$/i, "Amazon"],
  [/^cohere/i, "Cohere"],
  [/^youbot$/i, "You.com"],
  [/^(grok|xai)$/i, "xAI"],
  [/^(zhipu|chatglm)/i, "Zhipu"],
]

const MODEL_VENDOR: Array<[RegExp, string]> = [
  [/^(gpt|chatgpt|o[134]\b|o[134]-|davinci|text-davinci)/i, "OpenAI"],
  [/^claude|^sonnet|^opus|^haiku|^fable/i, "Anthropic"],
  [/^(gemini|gemma|palm|bard)/i, "Google"],
  [/^grok/i, "xAI"],
  [/^deepseek/i, "DeepSeek"],
  [/^(mistral|mixtral|codestral|ministral)/i, "Mistral"],
  [/^(llama|meta-llama)/i, "Meta"],
  [/^(qwen|tongyi)/i, "Alibaba"],
  [/^(glm|chatglm|zhipu)/i, "Zhipu"],
  [/^(sonar|pplx)/i, "Perplexity"],
  [/^(command|cohere)/i, "Cohere"],
  [/^(nova|titan)/i, "Amazon"],
]

export function vendorOfFetcher(fetcher: string | null | undefined): string | null {
  const f = (fetcher ?? "").trim()
  if (!f) return null
  for (const [re, v] of FETCHER_VENDOR) if (re.test(f)) return v
  return null
}

export function vendorOfModel(model: string | null | undefined): string | null {
  const m = (model ?? "").trim().toLowerCase()
  if (!m) return null
  for (const [re, v] of MODEL_VENDOR) if (re.test(m)) return v
  return null
}

/** The AI fetcher named in a User-Agent (from the shared fetcher list), or null. */
export function fetcherOfUa(ua: string | null | undefined): string | null {
  const lower = (ua ?? "").toLowerCase()
  if (!lower) return null
  for (const name of AI_FETCHERS) if (lower.includes(name.toLowerCase())) return name
  return null
}

export type UaInfo = { browser: string | null; os: string | null; fetcher: string | null; fetcherVendor: string | null; family: string }

export function parseUa(ua: string | null | undefined): UaInfo {
  const u = (ua ?? "").trim()
  const l = u.toLowerCase()
  const fetcher = fetcherOfUa(u)
  let browser: string | null = null
  if (/\bedg(e|a|ios)?\//.test(l)) browser = "Edge"
  else if (/firefox|fxios/.test(l)) browser = "Firefox"
  else if (/opr\/|opera/.test(l)) browser = "Opera"
  else if (/chrome|chromium|crios/.test(l)) browser = "Chrome"
  else if (/safari/.test(l) && !/chrome/.test(l)) browser = "Safari"
  else if (/curl\//.test(l)) browser = "curl"
  else if (/python|aiohttp|httpx|requests/.test(l)) browser = "Python"
  else if (/node|undici|axios/.test(l)) browser = "Node"
  let os: string | null = null
  if (/windows nt/.test(l)) os = "Windows"
  else if (/android/.test(l)) os = "Android"
  else if (/iphone|ipad|ios/.test(l)) os = "iOS"
  else if (/mac os x|macintosh/.test(l)) os = "macOS"
  else if (/linux|x11/.test(l)) os = "Linux"
  return { browser, os, fetcher, fetcherVendor: vendorOfFetcher(fetcher), family: fetcher ?? browser ?? "unknown" }
}

// ---- CIDR matching (IPv4 and IPv6) ------------------------------------------------------------------------------------------------
// BigInt() calls, not 1n literals: the repo's tsconfig targets below ES2020, and the tests that import this file are type-checked with it.
const B8 = BigInt(8)
const B16 = BigInt(16)
const B24 = BigInt(24)
const MASK16 = BigInt(0xffff)

function ipv4ToBig(ip: string): bigint | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const o = m.slice(1, 5).map(Number)
  if (o.some((n) => n > 255)) return null
  return (BigInt(o[0]) << B24) | (BigInt(o[1]) << B16) | (BigInt(o[2]) << B8) | BigInt(o[3])
}

function ipv6ToBig(ip: string): bigint | null {
  if (!ip.includes(":") || !/^[0-9a-f:.]+$/i.test(ip)) return null
  let work = ip.toLowerCase()
  const tail4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(work)
  if (tail4) {
    const v4 = ipv4ToBig(tail4[1])
    if (v4 === null) return null
    work = work.slice(0, work.length - tail4[1].length) + ((v4 >> B16) & MASK16).toString(16) + ":" + (v4 & MASK16).toString(16)
  }
  const halves = work.split("::")
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(":") : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null
  const groups = [...head, ...Array(fill).fill("0"), ...tail]
  if (groups.length !== 8) return null
  let out = BigInt(0)
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    out = (out << B16) | BigInt(parseInt(g, 16))
  }
  return out
}

function ipToBig(ip: string): { v: 4 | 6; n: bigint } | null {
  const t = ip.trim().replace(/^\[|\]$/g, "").split("%")[0]
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(t)
  const four = ipv4ToBig(mapped ? mapped[1] : t)
  if (four !== null) return { v: 4, n: four }
  const six = ipv6ToBig(t)
  return six === null ? null : { v: 6, n: six }
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, lenText] = cidr.trim().split("/")
  const a = ipToBig(ip)
  const b = ipToBig(base)
  if (!a || !b || a.v !== b.v) return false
  const bits = a.v === 4 ? 32 : 128
  const len = lenText === undefined ? bits : Number(lenText)
  if (!Number.isInteger(len) || len < 0 || len > bits) return false
  const shift = BigInt(bits - len)
  return (a.n >> shift) === (b.n >> shift)
}

export type VendorRanges = Record<string, string[]>

/** Parse the DPDP_AUDIT_VENDOR_IP_RANGES secret. Anything malformed gives no ranges (the network proof then reads "not_checked"), never a crash. */
export function parseVendorRanges(json: string | null | undefined): VendorRanges {
  if (!json || !json.trim()) return {}
  try {
    const raw = JSON.parse(json) as unknown
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
    const out: VendorRanges = {}
    for (const [vendor, list] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(list)) out[vendor] = list.filter((c): c is string => typeof c === "string").slice(0, 5000)
    }
    return out
  } catch {
    return {}
  }
}

export function vendorOfIp(ip: string | null | undefined, ranges: VendorRanges): string | null {
  if (!ip) return null
  for (const [vendor, cidrs] of Object.entries(ranges)) if (cidrs.some((c) => ipInCidr(ip, c))) return vendor
  return null
}

// ---- the AI provenance block --------------------------------------------------------------------------------------------------------

export type AiDeclaration = { model: string | null; version: string | null; sessionId: string | null; machineId: string | null }

/** The self-declaration, from headers (X-AI-Model ...) first, then query parameters (?ai_model= ...). Values are clipped; nothing else is read. */
export function readDeclaration(headers: { get(n: string): string | null }, params: URLSearchParams): AiDeclaration {
  const pick = (h: string, q: string): string | null => {
    const v = (headers.get(h) ?? params.get(q) ?? "").trim().replace(/[\u0000-\u001f]/g, "")
    return v === "" ? null : v.slice(0, 120)
  }
  return { model: pick("x-ai-model", "ai_model"), version: pick("x-ai-version", "ai_version"), sessionId: pick("x-ai-session", "ai_session"), machineId: pick("x-ai-machine", "ai_machine") }
}

export type AiProvenance = {
  fetcher: string | null
  vendorObservedUa: string | null
  vendorObservedNetwork: string | null
  vendorDeclared: string | null
  declared: AiDeclaration
  proof: { ua: ProofLevel; network: ProofLevel; model: ProofLevel; vendor: ProofLevel }
  mismatch: boolean
  mismatchReasons: string[]
}

export function assessProvenance(opts: { userAgent: string | null; ip: string | null; declared: AiDeclaration; ranges: VendorRanges }): AiProvenance {
  const ua = parseUa(opts.userAgent)
  const uaVendor = ua.fetcherVendor
  const haveRanges = Object.keys(opts.ranges).length > 0
  const netVendor = haveRanges ? vendorOfIp(opts.ip, opts.ranges) : null
  const declVendor = vendorOfModel(opts.declared.model)
  const reasons: string[] = []
  if (uaVendor && netVendor && uaVendor !== netVendor) reasons.push(`user-agent says ${uaVendor} but the network address belongs to ${netVendor}`)
  if (declVendor && uaVendor && declVendor !== uaVendor) reasons.push(`declared model looks like ${declVendor} but the user-agent says ${uaVendor}`)
  if (declVendor && netVendor && declVendor !== netVendor) reasons.push(`declared model looks like ${declVendor} but the network address belongs to ${netVendor}`)
  // A caller that NAMES an AI fetcher in its user-agent but whose address is in no published range is not a mismatch (many fetch from private ranges), it is simply unproven.
  return {
    fetcher: ua.fetcher,
    vendorObservedUa: uaVendor,
    vendorObservedNetwork: netVendor,
    vendorDeclared: declVendor,
    declared: opts.declared,
    proof: {
      ua: opts.userAgent ? "observed" : "not_checked",
      network: haveRanges ? "observed" : "not_checked",
      model: opts.declared.model ? "declared" : "not_checked",
      vendor: declVendor ? "inferred" : "not_checked",
    },
    mismatch: reasons.length > 0,
    mismatchReasons: reasons,
  }
}
