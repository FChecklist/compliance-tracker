import { Card, CardContent } from "@/components/ui/card"

// WO-DPDP-003 spec, "🛟 If something goes wrong" -- fully static, no
// backend. Copy taken verbatim from the owner-supplied spec file (the work
// order says not to rewrite it).
const SCENARIOS: Array<[string, string]> = [
  ["👋 Somebody leaves in the middle of a job", "Change the name against the job. Everything moves in one step, their link dies that minute, and what they already did stays on the record under their name."],
  ["🙅 An outside firm refuses to sign", "Recorded as a refusal. You cannot lawfully ask them anything, and their refusal is itself a finding your auditor will see. Most sign once they understand the client can replace them."],
  ["🤐 The client stops answering", "Reminders go at 7 and 1 days, then every 3 days. At 14 days late the boss is told. If the whole file stalls, your CA can pause the engagement — and the record shows exactly who went quiet and when."],
  ["↩️ Proof gets rejected twice", "It goes back with a written reason each time. On the second rejection the person's boss is copied, because two rejections usually means they have misunderstood, not that they are refusing."],
  ["🚨 Data leaks in the middle of everything", "The 72-hour clock takes priority over everything else on screen. Every other deadline pauses in the display so nobody is confused about what matters today."],
  ["⛔ Somebody asks to be deleted, and you cannot", "Some records must be kept by law — payroll, for example. You answer within 90 days explaining which law, and that answer goes on the record. You may not simply ignore them."],
  ["🎂 A child turns 18", "The school moves from parental consent to the young adult's own. We flag it in the month it happens; the old parental consent is kept, not deleted."],
  ["🚪 A client leaves you", "Everything is exported in open formats and handed over. Nothing is held hostage. Their public page keeps working for 90 days so their customers are not stranded."],
  ["🔄 A company changes its CA", "The new firm takes the review seat. Every record made before they arrived stays exactly as it was, with the old firm's name on it."],
  ["📅 A deadline passes anyway", "It is not hidden and not quietly moved. It shows as late, with the number of days, until it is dealt with. A tool that hides a missed deadline is worse than no tool."],
  ["🤷 Somebody has no idea what a question means", "Every job has an \"I am stuck\" button. It emails whoever set the job, with the question attached. Nobody has to admit confusion in front of their boss."],
  ["📵 Somebody never opens their email", "Unopened is recorded separately from unanswered. After three days we stop relying on it and escalate sooner, because an unread inbox is the commonest reason nothing happens."],
]

export default function EdgePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">🛟 If something goes wrong</h1>
      <p className="text-sm text-[#564D77] mb-4">The awkward situations that actually happen, and what the product does about each. Nothing here needs you to phone anybody.</p>
      <Card>
        <CardContent className="pt-6 divide-y divide-[#F2EFFB]">
          {SCENARIOS.map(([title, body]) => (
            <div key={title} className="py-3 first:pt-0 last:pb-0">
              <div className="font-semibold text-sm">{title}</div>
              <div className="text-sm text-[#564D77] mt-1">{body}</div>
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="mt-4 rounded-xl bg-gradient-to-r from-[#F2ECFF] to-[#CFFAFE] p-4 text-sm">
        <b>The rule behind all of these:</b> nothing is ever deleted and nothing is quietly moved. If something goes wrong, the record says so, plainly, with a date. That is uncomfortable — and it is the only version that is worth anything when somebody asks years later.
      </div>
    </div>
  )
}
