// The job playbook: for every job in the library, what an AI helping a busy non-lawyer needs so it does not have to think -- why the job
// matters, who does it, the steps, the questions to ask the person, what "done" looks like and where the proof lives, the note to record,
// when (if ever) "not applicable" is honest, and a ready-to-send email where an outside firm or a colleague has to act.
//
// Owner, 2026-09-30: "THE EXTERNAL AI SHOULD BE ABLE TO UNDERSTAND THE WHOLE THING ... WHY TO DO, HOW TO DO, WHERE TO DO, FOR WHOM TO DO, HOW
// TO UPDATE, WHAT QUESTIONS THE EXTERNAL AI TO ASK THE USER, WHAT ANSWERS THE EXTERNAL AI TO GIVE TO THE USER, FILE PATHS, EMAIL TO SEND".
//
// Served three ways, all from this one module: inside the personal page (the jobs that most need doing, in full: manual.ts section P),
// with every job (`GET /jobs/{id}` carries `playbook`), and for a whole view at once (`GET /playbook`). The words for the 59 library jobs
// are in playbook-data.ts, keyed by the library's own key (`firm-07`, `institution-22`). The library will be replaced by a
// lawyer-reviewed version (WO-DPDP-010); a job whose key is not in the table still gets a useful, honest generic playbook for its Part.
//
// HONESTY RULE (facts.ts, law.ts): the playbook never states a section, rule number, penalty or deadline of its own. The law behind a job
// is fetched with GET /law/{code} (law.ts words, with their `verify` notes); the playbook is the practical half. PURE: no Deno globals.

import { PLAYBOOK_DATA } from "./playbook-data.ts"

export type PlaybookEmail = { to: string; subject: string; body: string }

export type JobPlaybook = {
  why: string
  who: string
  steps: string[]
  ask: string[]
  proof: string
  note: string
  notApplicableWhen: string | null
  email: PlaybookEmail | null
  watchFor: string[]
}

export type PlaybookSource = "library" | "generic"

export const PART_NAMES: Record<number, string> = {
  1: "Basics", 2: "Know your data", 3: "Tell people & take consent", 4: "Keep it safe", 5: "Firms you share data with", 6: "Requests & complaints", 7: "Sign off",
}

/** What each Part of the list is about, in words for the person, and the generic way to work a job in it (used when a job has no playbook of its own). */
export const PART_GUIDE: Record<number, { about: string; how: string[]; ask: string[]; proof: string }> = {
  1: {
    about: "the people who are named as responsible for data protection, and the public way to reach them",
    how: ["Agree who will be responsible.", "Write down their name, role, email and phone.", "Make sure the person knows they have been named.", "Put the contact where people can find it, if the job says so."],
    ask: ["Who is this person, exactly (full name and role)?", "How can people reach them (email and phone)?"],
    proof: "The name and contact written down, and, where the job says publish, the page or notice where people can see it.",
  },
  2: {
    about: "knowing what personal data the organisation holds, where it is kept, why, and who can open it",
    how: ["List where this data lives (a system, a register, a folder, a phone).", "Write why it is collected.", "Write who can open it.", "Write how long it is kept, if the job asks."],
    ask: ["Where exactly is this data kept?", "Why do you need it?", "Who can open it today?"],
    proof: "A short written note, kept in the organisation's own folder, listing where the data is, why it is held and who can open it.",
  },
  3: {
    about: "telling people what is held and why, and asking for their agreement where it is needed",
    how: ["Find where this data is collected (form, website, invoice, admission form, camera).", "Check what the person is told at that moment.", "Fix or add the notice or the consent step.", "Keep a copy of the wording that is now in use."],
    ask: ["Where do you collect this data from people?", "What are they told today, if anything?", "Who can change that form, notice or page?"],
    proof: "A copy or photo of the notice, form or page as it now stands, kept in the organisation's own folder.",
  },
  4: {
    about: "keeping personal data safe, and knowing what to do if something goes wrong",
    how: ["Check what protection is in place today.", "Fix the gaps, starting with the simplest (passwords, access, backups).", "Write down what was done and by whom.", "Tell the people who need to follow the rule."],
    ask: ["What is in place today?", "Who looks after computers and systems?", "Is anything missing that can be fixed this week?"],
    proof: "A short written note of what is in place and who checked it, kept in the organisation's own folder.",
  },
  5: {
    about: "the outside firms that handle the organisation's personal data, and the written agreement with each of them",
    how: ["Name the outside firm and what data they handle.", "Ask them, in writing, to agree to look after the data as the organisation requires.", "Keep their signed reply.", "Follow up if there is no answer by the due date."],
    ask: ["Which firm is it, and who is your contact there?", "Do you already have a written agreement with them?"],
    proof: "The signed agreement or the firm's written reply, kept in the organisation's own folder.",
  },
  6: {
    about: "how people can ask about their data or complain, and how the organisation answers them",
    how: ["Decide who receives requests and complaints.", "Publish how people can reach them.", "Agree how each request or complaint is logged and answered, and by when.", "Keep a record of each one."],
    ask: ["Who receives requests and complaints today?", "Where can people find how to contact them?", "Have there been any requests or complaints recently?"],
    proof: "The published contact or procedure, and a log of requests and complaints with dates.",
  },
  7: {
    about: "the final confirmation that the answers are true, then the CA firm's check and signature",
    how: ["Make sure every earlier part is complete.", "Read the answers once more.", "Confirm, or fix what is wrong first.", "The CA manager then checks the proof and the CA partner signs the file."],
    ask: ["Is every answer on the list true today?", "Is any job still open that should be closed first?"],
    proof: "The dated confirmation, check and signature recorded on the list.",
  },
}

export type PlaybookJob = { part: number; what: string; requiredToday?: boolean; answeredByOutsideFirm?: boolean }

/** The playbook for a job: its own if the library key is in the table, else a generic one for its Part. Never throws, never empty. */
export function playbookFor(templateKey: string | null | undefined, job: PlaybookJob): { playbook: JobPlaybook; source: PlaybookSource } {
  const own = templateKey ? PLAYBOOK_DATA[templateKey] : undefined
  if (own) return { playbook: own, source: "library" }
  const g = PART_GUIDE[job.part] ?? PART_GUIDE[2]
  return {
    source: "generic",
    playbook: {
      why: `This job is part of "${PART_NAMES[job.part] ?? "the list"}": ${g.about}. Use GET /law/{code} for each law code the job lists to see what it is based on.`,
      who: "The person it is assigned to does it; anyone whose information is needed helps. Ask the person who that is.",
      steps: g.how,
      ask: g.ask,
      proof: g.proof,
      note: "Done on {date}. {what was done, in one sentence}. Kept at {where the proof is kept}.",
      notApplicableWhen: null,
      email: null,
      watchFor: ["Do not guess: if the person is not sure, note what is missing and leave the job open."],
    },
  }
}

const numbered = (items: string[]): string[] => items.map((s, i) => `${i + 1}. ${s}`)

/** The playbook as short bullets, one fact each, for the page (the email, if any, follows as its own text block: playbookEmailText). */
export function playbookBullets(p: JobPlaybook): string[] {
  const out = [
    `Why: ${p.why}`,
    `Who: ${p.who}`,
    ...p.steps.map((s, i) => `Step ${i + 1}: ${s}`),
    ...p.ask.map((q, i) => `Ask ${i + 1}: ${q}`),
    `Done looks like: ${p.proof}`,
    `Note to record: ${p.note}`,
  ]
  if (p.notApplicableWhen) out.push(`Not applicable when: ${p.notApplicableWhen}`)
  for (const w of p.watchFor) out.push(`Watch for: ${w}`)
  if (p.email) out.push(`Email to send (the person sends it): to ${p.email.to}. The text is just below.`)
  return out
}

/** An email as plain text: To, Subject, a blank line, the body. */
export function playbookEmailText(e: PlaybookEmail): string {
  return `To: ${e.to}\nSubject: ${e.subject}\n\n${e.body}`
}

/** The playbook as plain lines (used in the page, in GET /jobs/{id}?format=md and in GET /playbook?format=md). */
export function playbookLines(p: JobPlaybook, opts: { includeEmail?: boolean } = {}): string[] {
  const out = [
    `Why: ${p.why}`,
    `Who: ${p.who}`,
    "Steps:",
    ...numbered(p.steps).map((s) => `  ${s}`),
    "Ask the person:",
    ...p.ask.map((q) => `  - ${q}`),
    `Done looks like: ${p.proof}`,
    `Note to record: ${p.note}`,
  ]
  if (p.notApplicableWhen) out.push(`Not applicable when: ${p.notApplicableWhen}`)
  if (p.watchFor.length) out.push(`Watch for: ${p.watchFor.join(" ")}`)
  if (p.email && opts.includeEmail !== false) {
    out.push(`Email to send (the person sends it; you cannot): to ${p.email.to}`, `  Subject: ${p.email.subject}`, ...p.email.body.split("\n").map((l) => `  ${l}`))
  }
  return out
}
