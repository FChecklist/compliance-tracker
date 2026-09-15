import { getDpdpAuthContext } from "@/lib/services/dpdp-session"
import { Card, CardContent } from "@/components/ui/card"

// Verbatim from the owner-supplied artefact's own lifecycle stages for a
// Fiduciary (veridian-complete.html, V.lifecycle, the `else` branch).
const STAGES: Array<[string, string, string]> = [
  ["B", "Open the account", "one person, free forever"],
  ["B", "Name who does what", "four or five names is normal"],
  ["B", "Say where each kind of data is kept", "the almirah counts"],
  ["B", "Name the outside firms who hold our data", "web agency, payroll, GPS"],
  ["C", "Get each of them under a signed agreement", "Section 8(2), before anything else"],
  ["C", "They answer what only they can", "the file paths nobody here has seen"],
  ["B", "Our own people do their jobs", "one email, one thing, four minutes"],
  ["A", "Our CA checks the proof", "or we do, if we have no CA"],
  ["B", "We sign off the answers", "the boss, nobody else"],
  ["P", "We ask our people for consent", "customers, staff, parents — on links"],
  ["B", "We publish the officer and the notices", "free, permanent page"],
  ["B", "It repeats every quarter", "and the record grows"],
]

export default async function LifecyclePage() {
  const ctx = await getDpdpAuthContext()
  if (!ctx) return null

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">🛤️ Where we are</h1>
      <p className="text-sm text-[#564D77] mb-4">Twelve stages from start to finished, and then it goes round again.</p>
      <div className="space-y-2">
        {STAGES.map((s, i) => (
          <Card key={i}>
            <CardContent className="pt-4 pb-4 flex gap-3 items-start">
              <div className="w-7 h-7 rounded-full bg-gradient-to-r from-[#6D28D9] to-[#9333EA] text-white flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</div>
              <div>
                <div className="font-semibold text-sm">{s[1]}</div>
                <div className="text-xs text-[#564D77]">{s[2]}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="mt-4 bg-[#F2ECFF]">
        <CardContent className="pt-6 text-sm">🔁 It never finishes, and that is the point. A record built over eight quarters shows a pattern of acting.</CardContent>
      </Card>
    </div>
  )
}
