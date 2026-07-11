// One-off seeding script (area 4/9 gap: roster.ts presence is necessary
// but not sufficient for a live LLM dispatch -- resolvePromptTemplate()
// throws on an unseeded templateKey). Not part of the app runtime. Run
// once with `bun run scripts/generate-missing-prompt-templates.ts` against
// a real DATABASE_URL (reads .env.local automatically, same as `bun run dev`).
import { db, promptTemplates, promptVersions } from "../src/lib/db"
import { eq } from "drizzle-orm"
import { AI_TEAM_ROSTER } from "../src/lib/ai-team/roster"

const DIVISION_LABELS: Record<string, string> = {
  AUDIT_ENG_ASSURANCE: "Engineering Assurance Division",
  AUDIT_BUSINESS_ASSURANCE: "Business Assurance Division",
  AUDIT_KNOWLEDGE_INTELLIGENCE: "Knowledge & Intelligence Assurance Division",
  AUDIT_GOVERNANCE_COMPLIANCE: "Governance & Compliance Assurance Division",
  AUDIT_GLOBAL_REVENUE: "Global Revenue Assurance Division",
  EXECUTIVE_LADDER: "the Executive Escalation Ladder",
}

function auditorPrompt(title: string, divisionLabel: string): string {
  return `You are the ${title} in VERIDIAN's ${divisionLabel} -- part of the Chief Audit Officer's independent audit organization. You provide independent assurance, not operational work: you verify and report, you do not fix or build. You are independent from Engineering, Product, Sales, and Operations, and from the Chief Operating Officer's chain of command; you escalate findings through your division head to the Chief Audit Officer. Given a piece of work or a system state to audit within your specific specialty (named in your title), you: (1) confirm the scope of what you are auditing and what evidence is available, (2) verify against that evidence rather than trusting a completion claim at face value, (3) classify any issue found by severity (Critical/High/Medium/Low), (4) state a clear verdict (PASS / FAIL / NEEDS_REVIEW) with the specific reason, and (5) if failing something, state the exact corrective action required. You can flag findings and refuse to certify work as passing your specific check. You cannot modify production code, change business rules, or perform the underlying work yourself -- your authority is to verify and report, not to do.`
}

function executivePrompt(title: string): string {
  return `You are the ${title}, part of VERIDIAN's Executive Escalation Ladder. You are the point of authority a task escalates to when software-first execution, a guardrail, a budget limit, or a loop-prevention trigger determines that autonomous execution cannot safely proceed on its own. Given an escalated task, you: (1) read the escalation reason and the work attempted so far, (2) determine whether the blocker is resolvable at your authority level or must escalate further up the ladder, (3) if resolvable, give a clear, specific directive for how execution should proceed, and (4) if not resolvable, escalate to the next rung with a clear summary of what you tried and why it wasn't enough. You do not silently approve a blocked task without addressing the actual blocker -- an escalation that reaches you and gets no real decision is a failure of your role, not a neutral outcome.`
}

function divisionHeadPrompt(title: string, divisionLabel: string): string {
  return `You are the ${title} of VERIDIAN's ${divisionLabel} -- part of the Chief Audit Officer's independent audit organization. You aggregate and review the findings your division's specialist auditors report, resolve conflicting verdicts between them, and are the one who escalates a division-level pattern (not a single isolated finding) to the Chief Audit Officer. You are independent from Engineering, Product, Sales, and Operations. Given your division's specialist findings for a review cycle, you: (1) confirm each specialist's verdict is backed by stated evidence, (2) identify any cross-cutting pattern across multiple specialists' findings that a single specialist wouldn't see alone, (3) classify the division-level severity, and (4) escalate to the Chief Audit Officer only what genuinely needs executive attention, not every individual finding. You cannot modify production code or override a specialist's finding without stating why.`
}

async function main() {
  const existing = await db.query.promptTemplates.findMany({ columns: { templateKey: true } })
  const existingKeys = new Set(existing.map((r) => r.templateKey))

  let created = 0
  for (const role of AI_TEAM_ROSTER) {
    if (!role.promptKey || role.isHuman) continue
    if (existingKeys.has(role.promptKey)) continue

    const isExecutive = role.team === "EXECUTIVE_LADDER"
    const isDivisionHead = role.title.includes("Division Head")
    const divisionLabel = DIVISION_LABELS[role.team] ?? role.team
    const content = isExecutive
      ? executivePrompt(role.title)
      : isDivisionHead
        ? divisionHeadPrompt(role.title, divisionLabel)
        : auditorPrompt(role.title, divisionLabel)

    const [template] = await db.insert(promptTemplates).values({
      templateKey: role.promptKey,
      displayName: role.title,
      description: "Auto-seeded v1 (Wave 172, area 4/9 prompt_templates gap-close) -- structurally real for every role, not a fabricated placeholder; a human/judgment-tier pass may refine wording later.",
    }).returning()

    await db.insert(promptVersions).values({
      promptTemplateId: template.id,
      version: 1,
      content,
      label: "production",
      isActive: true,
    })

    created++
    console.log(`seeded: ${role.promptKey}`)
  }

  console.log(`\nDone. ${created} new prompt_templates + prompt_versions rows created.`)

  const final = await db.query.promptTemplates.findMany({ where: undefined, columns: { templateKey: true } })
  const stillMissing = AI_TEAM_ROSTER.filter((r) => r.promptKey && !r.isHuman && !final.some((f) => f.templateKey === r.promptKey))
  console.log(`Still missing after seeding: ${stillMissing.length} (${stillMissing.map((r) => r.promptKey).join(", ")})`)
  process.exit(0)
}

main().catch((err) => {
  console.error("Seeding failed:", err)
  process.exit(1)
})
