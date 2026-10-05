// ONE e-mail header and footer for everything Veridian's DPDP product sends (owner, 2026-10-05: "one consistent header (logo/wordmark) and footer
// (name, support address, legal links)"). The Monday digest, the billing receipt and reminders, the partner mails and the unfamiliar-use alert all
// take their header and footer from here, and src/lib/services/dpdp-mail-brand.test.ts fails if a builder's output lacks either.
//
// NAMING: the name in a customer's inbox is the From name, "VERIDIAN AI DPDP" (_shared/mail-outbound.ts DEFAULT_FROM), and the plain-text mails have
// always signed "-- VERIDIAN AI DPDP"; this module uses that one name. The app and the Supabase Auth sender say "VERIDIAN DPDP". That is a conflict
// of names, listed in ai-os/DPDP_BRANDING_INVENTORY.md for the owner to settle; it is not guessed away here.
//
// PURE: no Deno globals, no network.

export const MAIL_BRAND_NAME = "VERIDIAN AI DPDP"
export const MAIL_SUPPORT = "dpdp@veridian-aios.com"
export const MAIL_LEGAL: ReadonlyArray<{ label: string; url: string }> = [
  { label: "Privacy", url: "https://veridian-aios.com/privacy/" },
  { label: "Refunds", url: "https://veridian-aios.com/refund/" },
]

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** The wordmark bar. */
export function brandHeaderHtml(): string {
  return `<div data-brand="header" style="background:#1C2B3A;padding:14px 20px;font-family:Inter,Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:.02em;color:#FFFFFF;">VERIDIAN <span style="color:#F5820A;">AI DPDP</span></div>`
}

/** Name, support address and (unless `links` is false) the legal links. The alert mail passes links:false: it must contain no link at all. */
export function brandFooterHtml(opts: { links?: boolean } = {}): string {
  const legal = opts.links === false ? "" : ` &middot; ${MAIL_LEGAL.map((l) => `<a href="${esc(l.url)}" style="color:#64748B;">${esc(l.label)}</a>`).join(" &middot; ")}`
  return `<div data-brand="footer" style="padding:12px 20px;border-top:1px solid #E2E8F0;font-family:Inter,Arial,sans-serif;font-size:12px;color:#64748B;">${esc(MAIL_BRAND_NAME)} &middot; ${esc(MAIL_SUPPORT)}${legal}</div>`
}

export function brandHeaderText(): string {
  return MAIL_BRAND_NAME
}

/** "-- VERIDIAN AI DPDP" then the support address and legal links: the signature the plain-text mails have always had, plus the two lines. */
export function brandFooterText(opts: { links?: boolean } = {}): string[] {
  const legal = opts.links === false ? "" : ` | ${MAIL_LEGAL.map((l) => `${l.label}: ${l.url}`).join(" | ")}`
  return [`-- ${MAIL_BRAND_NAME}`, `${MAIL_SUPPORT}${legal}`]
}

/** Wraps a finished { subject, text, html } in the header and footer. Idempotent: output that already carries them is returned as it is. */
export function brandWrap<T extends { subject: string; text: string; html: string }>(r: T, opts: { links?: boolean } = {}): T {
  if (r.html.includes('data-brand="header"')) return r
  const text = [brandHeaderText(), "", r.text.replace(/\n*-- VERIDIAN AI DPDP\s*$/, ""), "", ...brandFooterText(opts)].join("\n")
  const html = `<div style="max-width:560px;margin:0 auto;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;">${brandHeaderHtml()}<div style="padding:18px 20px;">${r.html}</div>${brandFooterHtml(opts)}</div>`
  return { ...r, text, html }
}
