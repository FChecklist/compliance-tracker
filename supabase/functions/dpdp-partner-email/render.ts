// Sales Partner emails (drizzle/0674). PURE module: no Deno, no network, so bun tests run it.
// Every email goes to the partner only and carries counts and amounts. It never carries a client's name
// or any client personal data, and never a payout detail (the notice payloads hold none).

import { brandWrap } from "../_shared/brand-mail.ts"

export type NoticeKind = "welcome" | "referred_signup" | "commission_earned" | "payout_sent" | "statement" | "details_changed"

export type Notice = {
  id: string
  kind: NoticeKind
  to: string
  name: string | null
  payload: Record<string, unknown>
}

export type Rendered = { subject: string; text: string; html: string }

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === "string" ? v : "")

export function rupees(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** "2026-09" -> "September 2026"; anything else is returned as is. */
export function monthLabel(period: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period)
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : period
}

/** "2026-10-10" -> "10 October 2026". */
export function dateLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}` : ymd
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

function shell(subject: string, lines: string[]): Rendered {
  const text = [...lines, "", "Questions? Reply to this email."].join("\n")
  const html = `<div style="font-family:sans-serif;max-width:520px">${[...lines, "", "Questions? Reply to this email."]
    .map((l) => (l === "" ? "<br>" : `<p style="margin:4px 0">${esc(l)}</p>`)).join("")}</div>`
  return brandWrap({ subject, text, html })
}

const TAX_LINE = "Tax (TDS) is deducted where the law requires it and shown on your statement."

export function renderNotice(n: Notice): Rendered {
  const hi = n.name ? `Hello ${n.name},` : "Hello,"
  const p = n.payload
  switch (n.kind) {
    case "welcome":
      return shell("You are now a VERIDIAN Sales Partner", [
        hi, "",
        "Your partner set-up is complete. You are an active VERIDIAN Sales Partner.",
        "Sign in and open Sales Partner to see your personal link and your dashboard.",
        "You earn 20% of each yearly payment from an organisation you referred, on every renewal.",
        "A commission becomes payable 30 days after the client's payment is confirmed. We pay once a month.",
        TAX_LINE,
      ])
    case "referred_signup": {
      const edition = str(p.edition) === "institution" ? "an institution" : "a firm"
      return shell("An organisation you referred has signed up", [
        hi, "",
        `${edition === "a firm" ? "A firm" : "An institution"} signed up with your personal link.`,
        "It starts with 30 free days. You earn a commission when it pays and we confirm the payment.",
        "For privacy we do not show the name of the organisation.",
      ])
    }
    case "commission_earned": {
      const b = str(p.basis)
      const basis = b === "yearly" ? "a yearly payment" : b === "monthly_first_year" ? "a monthly payment in its first year" : "a first monthly payment"
      return shell(`You earned a commission of ${rupees(num(p.amountPaise))}`, [
        hi, "",
        `We confirmed ${basis} from an organisation you referred.`,
        `Your commission: ${rupees(num(p.amountPaise))}.`,
        "It becomes payable 30 days after the payment was confirmed. We pay it in the next monthly payout.",
        TAX_LINE,
      ])
    }
    case "payout_sent":
      return shell(`Your commission payout of ${rupees(num(p.netPaise))} was sent`, [
        hi, "",
        `We sent your commission payout for ${monthLabel(str(p.period))}.`,
        `Commissions paid: ${num(p.commissions)}`,
        `Gross: ${rupees(num(p.grossPaise))}`,
        `TDS: ${rupees(num(p.tdsPaise))}`,
        `Net sent to you: ${rupees(num(p.netPaise))}`,
        `Paid by ${str(p.method) === "upi" ? "UPI" : "bank transfer"}. Reference: ${str(p.reference)}`,
        "Your statement shows the same lines.",
      ])
    case "statement": {
      const period = monthLabel(str(p.period))
      return shell(`Your Sales Partner statement for ${period}`, [
        hi, "",
        `Your statement for ${period}:`,
        `Commissions made in the month: ${rupees(num(p.madePaise))}`,
        `Paid in the month: gross ${rupees(num(p.paidGrossPaise))}, TDS ${rupees(num(p.paidTdsPaise))}, net ${rupees(num(p.paidNetPaise))}`,
        `Waiting for the 30 days to pass: ${rupees(num(p.waitingPaise))}`,
        `Payable in the next payout: ${rupees(num(p.payablePaise))}`,
        `Next payout date: ${dateLabel(str(p.nextPayoutOn))}. A balance under ${rupees(num(p.minPayoutPaise))} carries forward.`,
        "Sign in and open Sales Partner to download the full statement as a file.",
        TAX_LINE,
      ])
    }
    case "details_changed":
      return shell("Your payout details were changed", [
        hi, "",
        "The payout details on your VERIDIAN Sales Partner profile were just changed.",
        "If you made this change, you do not need to do anything.",
        "If you did not, write to us at once by replying to this email.",
      ])
  }
}

/** True only for an address a real mailbox could sit behind (the same rule the Monday email uses). */
export function isDeliverableAddress(email: string): boolean {
  const e = email.trim().toLowerCase()
  const at = e.lastIndexOf("@")
  if (at <= 0) return false
  const domain = e.slice(at + 1)
  if (!domain || !domain.includes(".")) return false
  if (/(^|\.)(test|example|invalid|localhost)$/.test(domain)) return false
  if (/^(example\.(com|net|org))$/.test(domain) || /\.example\.(com|net|org)$/.test(domain)) return false
  return true
}
