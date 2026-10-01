// Sales Partner helpers (drizzle/0674): money text, the CSV downloads, month lists.
// Pure TypeScript, no imports from the app, so bun tests run it.
import type { AdminPayoutRun, PartnerStatementPayload } from "./rpc-types"

/** "Rs 1,999.80" -- always two decimals, the way a statement is read. */
export function rupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "--"
  return `Rs ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "1999.80" for a CSV cell. */
export function rupeesPlain(paise: number | null | undefined): string {
  return paise === null || paise === undefined ? "" : (paise / 100).toFixed(2)
}

/** A CSV cell. Quotes when needed, and defuses a leading = + - @ (a spreadsheet would run it as a formula). */
export function csvCell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? "" : String(v)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"
}

const BASIS: Record<string, string> = { yearly: "Yearly payment", first_month: "First monthly payment" }
const STATUS: Record<string, string> = { waiting: "Waiting for 30 days", payable: "Payable", paid: "Paid" }

/** The partner's monthly statement as a CSV: the commission lines, then the payouts, then the totals. Gross, TDS and net on every line. */
export function statementCsv(s: PartnerStatementPayload): string {
  const rows: Array<Array<string | number | null | undefined>> = [
    ["VERIDIAN Sales Partner statement"], ["Month", s.period], ["Partner", s.email], [],
    ["Commission lines"],
    ["Made on", "Basis", "Rate %", "Gross (Rs)", "TDS (Rs)", "Net (Rs)", "Status", "Payable on", "Paid on"],
    ...s.lines.map((l) => [l.madeOn, BASIS[l.basis] ?? l.basis, l.ratePercent, rupeesPlain(l.grossPaise), rupeesPlain(l.tdsPaise), rupeesPlain(l.netPaise), STATUS[l.status] ?? l.status, l.payableOn, l.paidOn ?? ""]),
    [], ["Payouts in the month"],
    ["Paid on", "For month", "Method", "Reference", "Commissions", "Gross (Rs)", "TDS (Rs)", "Net (Rs)"],
    ...s.payouts.map((p) => [p.paidOn, p.period, p.method === "upi" ? "UPI" : "Bank transfer", p.reference, p.commissions, rupeesPlain(p.grossPaise), rupeesPlain(p.tdsPaise), rupeesPlain(p.netPaise)]),
    [], ["Totals"],
    ["Commissions made in the month (Rs)", rupeesPlain(s.totals.madePaise)],
    ["Paid in the month: gross (Rs)", rupeesPlain(s.totals.paidGrossPaise)],
    ["Paid in the month: TDS (Rs)", rupeesPlain(s.totals.paidTdsPaise)],
    ["Paid in the month: net (Rs)", rupeesPlain(s.totals.paidNetPaise)],
    ["Still waiting or payable (Rs)", rupeesPlain(s.totals.stillWaitingPaise)],
    [], ["Tax (TDS) is deducted where the law requires it and shown on your statement."],
  ]
  return csv(rows)
}

/** The Owner's payout list for the bank / UPI app: only partners who meet the minimum. The Reference column is left empty, to fill with the UTR. */
export function payoutRunCsv(run: AdminPayoutRun): string {
  const rows: Array<Array<string | number | null | undefined>> = [
    ["Partner email", "Payee name", "Method", "UPI id", "Account number", "IFSC", "PAN", "Commissions", "Gross (Rs)", "TDS (Rs)", "Net to pay (Rs)", "For month", "Reference (UTR)"],
    ...run.partners.filter((p) => p.meetsMinimum).map((p) => [
      p.email, p.accountName ?? p.name, p.method === "upi" ? "UPI" : "Bank transfer", p.upiId, p.accountNumber, p.ifsc, p.pan,
      p.commissions, rupeesPlain(p.grossPaise), rupeesPlain(p.tdsPaise), rupeesPlain(p.netPaise), run.period, "",
    ]),
  ]
  return csv(rows)
}

/** The last `count` months before `now`, newest first, as "YYYY-MM" (UTC). */
export function recentPeriods(now: Date, count = 12): string[] {
  const out: string[] = []
  let y = now.getUTCFullYear()
  let m = now.getUTCMonth() + 1
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`)
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
  }
  return out
}

/** Triggers a browser download of text. */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const STATUS_TEXT: Record<string, { label: string; line: string }> = {
  applied: { label: "Set-up not finished", line: "Accept the terms and add your payout details. Then you are active and your link appears." },
  active: { label: "Active", line: "Your link is live. You earn when an organisation you referred pays." },
  paused: { label: "Paused", line: "Your partnership is paused. New sign-ups through your link are not counted. Write to us with the subject Partner." },
  ended: { label: "Ended", line: "Your partnership has ended. Commissions already confirmed are still paid. Write to us with the subject Partner to join again." },
}
