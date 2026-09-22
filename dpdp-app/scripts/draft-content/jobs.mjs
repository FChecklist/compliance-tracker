// WO-DPDP-012 §5 job pages: "one public page per job in the 59-job library,
// generated from the library data (never retyped): the plain task, the law
// tags, the data set and data types, why it matters, what done looks like."
//
// This module turns ONE library template (a row of
// data/dpdp-library-0.2-wo010.json) into the page model render.mjs
// renders. Every fact on the page -- the task text, the law codes, the data
// set and types, who answers, the proof kind, the default days, the
// dependency -- is read from the template. The connective prose around
// those facts is template text written once here, so a wrong word is fixed
// once and 59 pages regenerate.

import {
  AREA_CAN_MARK_NA, AREA_HELP, IN_FORCE_2027, IN_FORCE_TODAY, LAWS, PARTS, ROLE_TAG_HELP, SENSITIVE_DATA_TYPES,
  citeLawCode, hasDpdp, isGoodPracticeOnly, isToday,
} from "./law.mjs"
import { describe } from "./render.mjs"

const PRODUCT = {
  firm: { one: "a company, firm or NGO", many: "companies, firms and NGOs", crumb: "For companies, firms and NGOs" },
  institution: { one: "a school", many: "schools", crumb: "For schools" },
}

// Why each Part matters -- one paragraph per Part, the same framing the one
// page's PartsTrack uses (PARTS names are verbatim from view-model.ts).
const WHY_PART = {
  1: "Nothing else in the file works until there is a named person to answer for it. Today's law and the DPDP Act start from the same place: someone whose name is published, who answers complaints, and who can say what the organisation holds.",
  2: "You cannot protect, explain or delete what you have not written down. The map of where personal data sits — which folder, which software, which cupboard — is the base that every notice, consent, security step and deletion request is measured against.",
  3: "A notice tells people what you hold and why; consent is their yes. Without both, the processing has no lawful ground — and a consent that cannot be withdrawn as easily as it was given does not count.",
  4: "Reasonable security is the duty most likely to be tested, because a leak is the moment everyone looks. Passwords, access limits, backups and a log of who opened what are what 'reasonable' looks like for a small organisation.",
  5: "The organisation stays answerable for what its website firm, payroll firm or software vendor does with the data. A signed data agreement is the only way to make an outside firm answer — and the only way to prove you asked.",
  6: "People can ask to see, correct and delete their data, and they can complain. A published way to ask, and an answer within the time the law sets, is the difference between a complaint that ends with you and one that goes to the Board.",
  7: "A record nobody signed is a record nobody stands behind. The sign-off turns a list of answers into a file a reviewer can rely on — dated, attributable, and closed.",
}

const WHY_FAMILY = {
  s: "This is today's law: under section 43A of the Information Technology Act, 2000, a body corporate that is negligent in keeping reasonable security practices can be ordered to compensate the person harmed.",
  a: "The Aadhaar Act 2016 restricts how Aadhaar numbers may be stored, shared and displayed; an unmasked Aadhaar copy is among the records most often leaked.",
  d: "From 13 May 2027, a person can take an unresolved grievance to the Data Protection Board of India, which can inquire and impose the penalties the Act's Schedule sets. This page does not quote figures — the Board decides each case, and no penalty order has been issued in India to date.",
  g: "There is no penalty attached to this job. It exists because the file stalls without it.",
}

function endSentence(s) {
  const t = s.trim()
  return /[.!?]$/.test(t) ? t : t + "."
}

function joinAnd(parts) {
  if (parts.length <= 1) return parts.join("")
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1]
}

// "DPDP Act 2023 §8(9) and §8(10), and SPDI Rules 2011 rule 5(9)"
function shortCitationList(cites) {
  const groups = []
  for (const c of cites) {
    if (c.family === "g") continue
    let g = groups.find((x) => x.instrument === c.shortInstrument)
    if (!g) { g = { instrument: c.shortInstrument, isRule: c.isRule, refs: [] }; groups.push(g) }
    g.refs.push(c.refText)
  }
  const rendered = groups.map((g) => `${g.instrument} ${g.isRule ? (g.refs.length > 1 ? "rules " : "rule ") : ""}${joinAnd(g.refs)}`)
  return rendered.length > 2 ? rendered.slice(0, -1).join(", ") + ", and " + rendered[rendered.length - 1] : joinAnd(rendered)
}

function inForceClause(codes) {
  const hasS = codes.some((c) => c[0] === "s")
  const hasA = codes.some((c) => c[0] === "a")
  const hasD = hasDpdp(codes)
  const todayParts = []
  if (hasS) todayParts.push(`the SPDI part is ${IN_FORCE_TODAY}`)
  if (hasA) todayParts.push("the Aadhaar Act part is in force today")
  if (todayParts.length && hasD) return `${joinAnd(todayParts)}, and the DPDP part is ${IN_FORCE_2027}`
  if (todayParts.length) return hasS && !hasA ? IN_FORCE_TODAY : hasA && !hasS ? "in force today" : joinAnd(todayParts)
  return IN_FORCE_2027
}

function whoPhrase(t) {
  const help = AREA_HELP[t.role_tag] ?? ROLE_TAG_HELP[t.role_tag]
  if (!help) throw new Error(`no help text for role_tag ${JSON.stringify(t.role_tag)} (${t.key}) -- add it to law.mjs`)
  return `${t.role_tag} — ${help}`
}

function proofShort(t) {
  if (t.proof_kind === "declaration") return "the person responsible presses Yes and the date and name are logged"
  if (t.proof_kind === "doc") return "the document exists and its fingerprint, name and date are logged"
  throw new Error(`unknown proof_kind ${t.proof_kind} (${t.key})`)
}

function proofLong(t) {
  if (t.proof_kind === "declaration") {
    return "A dated declaration in the VERIDIAN record: the person responsible presses Yes, and the date and their name go into a log that cannot be edited afterwards. VERIDIAN does not connect to your systems or read your files — it records what you declare and holds you to it."
  }
  return "The document itself, kept by you where it belongs (here, published where people can find it). VERIDIAN records only its fingerprint, its name and the date — never the document — so a reviewer can later prove which version existed on which day."
}

function dataBlocks(t) {
  const blocks = []
  if (!t.data_set || t.data_set === "Whole organisation" || t.data_set === "Whole school") {
    blocks.push({ type: "p", text: `${t.data_set ?? "Whole organisation"} — this job is about the organisation as a whole, not one data set.` })
    return blocks
  }
  const sets = t.data_set.split(" · ")
  blocks.push({ type: "p", text: sets.length > 1 ? `Data sets: ${joinAnd(sets)}.` : `Data set: ${t.data_set}.` })
  if (t.data_types && t.data_types.length) {
    const items = t.data_types.map((d) => {
      if (d === "All of the above") return { text: d, note: "(the types listed for this data set in the earlier jobs of the same file)" }
      if (d === "All") return { text: d, note: "(every type held in this data set)" }
      return SENSITIVE_DATA_TYPES.includes(d) ? { text: d, note: "(marked sensitive on the one page — extra care)" } : d
    })
    blocks.push({ type: "p", text: "Data types this job covers:" })
    blocks.push({ type: "ul", items })
  }
  return blocks
}

/** Build the page model for one library template. `byKey` resolves depends_on_key. */
export function jobPage(t, lib, byKey) {
  const product = PRODUCT[t.product]
  if (!product) throw new Error(`unknown product ${t.product} (${t.key})`)
  const part = PARTS.find((p) => p.n === t.part)
  if (!part) throw new Error(`unknown part ${t.part} (${t.key})`)
  const codes = t.law_codes ?? []
  if (!codes.length) throw new Error(`no law_codes on ${t.key}`)
  const cites = codes.map(citeLawCode)
  const gOnly = isGoodPracticeOnly(codes)
  const task = endSentence(t.plain_text)
  const exportedDate = lib.exportedAt.slice(0, 10)

  const answer = [task]
  if (gOnly) answer.push(`For ${product.one}, this is not a legal duty — it keeps the work moving.`)
  else answer.push(`For ${product.one}, this comes from ${shortCitationList(cites)} — ${inForceClause(codes)}.`)
  answer.push(`Usually done by ${whoPhrase(t)}; it counts as done when ${proofShort(t)}.`)

  const lawItems = cites.map((c) => {
    if (c.family === "g") return { text: c.full }
    const text = c.topic ? `${c.full} — ${c.topic}.` : `${c.full}.`
    return c.verify ? { text, note: `[VERIFY: ${c.verify}]` } : { text }
  })
  const lawBlocks = [{ type: "ul", items: lawItems }]
  if (isToday(codes) && hasDpdp(codes)) {
    lawBlocks.push({ type: "p", cls: "note", text: "Both apply: the today's-law duty is what you can be held to now; the DPDP duty is what replaces it on 13 May 2027. Doing it once satisfies both." })
  }

  const familiesPresent = [...new Set(codes.map((c) => c[0]))]
  const inForceItems = familiesPresent.map((f) => LAWS[f].title)
  const inForceNote = gOnly
    ? "No date attaches to this job. It is here because the file does not move without it."
    : isToday(codes)
      ? "Do this now: the one page counts this job as required by today's law, and it is late the day it is missed — not on 13 May 2027."
      : "The one page counts this job towards 13 May 2027. The date is the real thing, not the fear."

  const whoBlocks = [{ type: "p", text: `${whoPhrase(t)}.` }]
  if (t.answerable_by === "processor") {
    whoBlocks.push({ type: "p", text: "This job is answered by an outside firm — a Data Processor in the Act's words — not by your own staff. It is free for them; the data agreement is what makes them answer, and they are blocked until they sign." })
  } else {
    whoBlocks.push({ type: "p", text: "Answered inside the organisation." })
  }
  if (t.applies_when?.grp) {
    whoBlocks.push({ type: "p", text: "This is a group job: every member answers privately for themselves — done, never had any, or cannot — and the job closes once everyone has answered." })
  }
  if (t.applies_when?.fromArea) {
    whoBlocks.push({ type: "p", text: "The person is named during the first visit, in the 'who looks after what' step, before the file starts." })
  }
  if (AREA_CAN_MARK_NA.includes(t.role_tag)) {
    whoBlocks.push({ type: "p", cls: "note", text: `If you have no ${t.role_tag.toLowerCase()}, the job can be marked "doesn't apply" and it drops out of the file.` })
  }

  const proofBlocks = [{ type: "p", text: proofLong(t) }]
  proofBlocks.push({ type: "p", text: `Proof kind: ${t.proof_kind}. Proof mode: ${t.proof_mode}. VERIDIAN gives this job ${t.default_days} days from the day the file starts; ${t.recurrence === "none" ? "it is done once, not repeated — unless the answers change" : `it recurs: ${t.recurrence}`}.${t.proof_expiry_days ? ` The proof expires after ${t.proof_expiry_days} days.` : ""}` })

  const whyBlocks = [{ type: "p", text: WHY_PART[t.part] }]
  for (const f of familiesPresent) whyBlocks.push({ type: "p", text: WHY_FAMILY[f] })

  const doneBlocks = [{ type: "p", text: `The job "${t.plain_text}" is marked Yes in the ${product.one.replace(/^a /, "")}'s VERIDIAN file by the person responsible for ${t.role_tag}, with the date, within the ${t.default_days}-day window — and the log line that records it is in the file's record, which cannot be edited afterwards.` }]
  if (t.depends_on_key) {
    const dep = byKey.get(t.depends_on_key)
    if (!dep) throw new Error(`${t.key} depends on unknown key ${t.depends_on_key}`)
    doneBlocks.push({ type: "p", text: `This job waits for ${dep.key} ("${dep.plain_text}") to be done first — it stays blocked until then.` })
  }
  if (t.part === 7) {
    doneBlocks.push({ type: "p", text: "Part 7 is the sign-off chain: once it is complete, the file is closed for the period and refreshes every quarter." })
  }

  return {
    lang: "en-IN",
    path: `/jobs/${t.key}/`,
    title: `${t.plain_text} — DPDP job ${t.key} for ${product.many} | ${"VERIDIAN"}`,
    description: describe(answer.slice(0, 2)),
    h1: t.plain_text,
    kicker: `DPDP job ${t.key} · Part ${part.n}: ${part.name} · for ${product.many}`,
    answer,
    sections: [
      { h2: "The law, by section and rule", blocks: lawBlocks },
      { h2: "In force today, or from 13 May 2027?", blocks: [{ type: "ul", items: inForceItems }, { type: "p", text: inForceNote }] },
      { h2: "Who usually does it", blocks: whoBlocks },
      { h2: "The data this covers", blocks: dataBlocks(t) },
      { h2: "What proof looks like", blocks: proofBlocks },
      { h2: "Why it matters", blocks: whyBlocks },
      { h2: "What done looks like", blocks: doneBlocks },
    ],
    breadcrumbs: [{ name: "DPDP jobs", path: "/jobs/" }, { name: product.crumb, path: `/jobs/${t.product}/` }],
    datePublished: exportedDate,
    dateModified: exportedDate,
    alternates: [],
    headerComment: [
      "UNPUBLISHED DRAFT -- WO-DPDP-012 §5 job page. Publish nothing legal until the owner confirms lawyer review.",
      `Source: dpdp-app/data/dpdp-library-${lib.version}.json, template ${t.id} (key ${t.key}), exported ${lib.exportedAt}.`,
      "Regenerated automatically whenever the lawyer-reviewed library replaces this version.",
    ].join("\n"),
  }
}
