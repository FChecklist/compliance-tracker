// WO-DPDP-013 §1.3-E `GET /law/{code}`: the plain-English meaning of a law
// code. A TS port of dpdp-app/scripts/draft-content/law.mjs (the citation
// table the public job pages are generated from) -- the SAME topic labels
// and the SAME verify notes, so an AI reading this link and a person
// reading the public page get one answer. The in-force fact itself comes
// from the database (dpdp_ai_link_law); this file only adds the words.
//
// HONESTY RULE (law.mjs's own, kept): a `verify` note means the reviewing
// lawyer has not yet confirmed that number/topic. It is returned as data
// so the AI can say so, never hidden. Do not remove a note here; the lawyer
// removes it in law.mjs and this file is re-synced. PURE: no Deno globals.

export const LAWS: Record<string, { label: string; title: string }> = {
  d: { label: "DPDP", title: "DPDP Act 2023 and Rules 2025 — in force from 13 May 2027" },
  s: { label: "SPDI", title: "IT Act §43A and SPDI Rules 2011 — in force TODAY, until 13 May 2027" },
  a: { label: "Aadhaar Act", title: "Aadhaar Act 2016 — in force today" },
  g: { label: "Good practice", title: "Not a legal duty — it keeps the work moving" },
}

export const ACT_NAMES = {
  dAct: "Digital Personal Data Protection Act, 2023",
  dRules: "Digital Personal Data Protection Rules, 2025",
  sAct: "Information Technology Act, 2000",
  sRules: "Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011",
  sRulesShort: "SPDI Rules 2011",
  aAct: "Aadhaar (Targeted Delivery of Financial and Other Subsidies, Benefits and Services) Act, 2016",
  aActShort: "Aadhaar Act 2016",
}

type Topic = { topic: string; verify?: string }

const DPDP_ACT_TOPICS: Record<string, Topic> = {
  "§4": { topic: "grounds for processing personal data — only for a lawful purpose, with consent or under a listed legitimate use" },
  "§5": { topic: "notice — what personal data is collected, for what purpose, how to exercise rights and how to complain to the Board" },
  "§6": { topic: "consent — free, specific, informed, unconditional and unambiguous, and withdrawable" },
  "§6(1)": { topic: "consent must be free, specific, informed, unconditional and unambiguous, given by a clear affirmative action" },
  "§6(4)": { topic: "withdrawing consent must be as easy as giving it", verify: "confirm §6(4) is the sub-section on ease of withdrawal" },
  "§7(i)": { topic: "a listed legitimate use — processing for the purposes of employment, or to protect the employer from loss or liability" },
  "§8(1)": { topic: "the Data Fiduciary stays responsible for compliance, irrespective of any agreement to the contrary" },
  "§8(2)": { topic: "a Data Processor may be engaged only under a valid contract" },
  "§8(4)": { topic: "appropriate technical and organisational measures to ensure the Act is observed" },
  "§8(5)": { topic: "reasonable security safeguards to prevent a personal data breach" },
  "§8(6)": { topic: "on a personal data breach, intimate the Board and each affected Data Principal" },
  "§8(7)": { topic: "erase personal data when consent is withdrawn or the purpose is no longer served, and make the Data Processor erase it too, unless a law requires retention" },
  "§8(9)": { topic: "publish the business contact information of the Data Protection Officer, or of a person able to answer questions about the processing", verify: "confirm §8(9) is the publish-the-contact sub-section in the enacted text" },
  "§8(10)": { topic: "an effective mechanism to redress the grievances of Data Principals", verify: "confirm §8(10) is the grievance-mechanism sub-section in the enacted text" },
  "§9": { topic: "processing of personal data of children — verifiable parental consent, no harm, no tracking or targeted advertising" },
  "§9(1)": { topic: "verifiable consent of the parent or lawful guardian before processing a child's personal data" },
  "§9(3)": { topic: "no tracking, behavioural monitoring or targeted advertising directed at children" },
  "§11": { topic: "the right to access information about one's personal data" },
  "§12": { topic: "the right to correction and erasure of personal data" },
  "§12(3)": { topic: "erase personal data on request unless retention is necessary for the specified purpose or required by law", verify: "confirm the sub-section number for erasure-on-request in the enacted text" },
  "§13": { topic: "the right of grievance redressal — a readily available means, and a response within the prescribed time" },
  "§16": { topic: "processing of personal data outside India — transfers may be restricted by notification" },
}

const DPDP_RULES_VERIFY = "rule numbers changed between the January 2025 draft and the notified Rules — confirm this rule number and topic against the notified text"
const DPDP_RULES_TOPICS: Record<string, Topic> = {
  R3: { topic: "the notice a Data Fiduciary gives — itemised, standalone, understandable, with the means to exercise rights and complain", verify: DPDP_RULES_VERIFY },
  R6: { topic: "reasonable security safeguards — at minimum encryption or masking, access control, logs, backups, and a contract clause binding the Data Processor", verify: DPDP_RULES_VERIFY },
  "R6(1)(c)": { topic: "logs, monitoring and review to detect, investigate and remedy unauthorised access", verify: DPDP_RULES_VERIFY },
  "R6(1)(f)": { topic: "the contract with a Data Processor must require the same safeguards", verify: DPDP_RULES_VERIFY },
  R7: { topic: "intimation of a personal data breach — to each affected person without delay, and to the Board, with the detailed report within 72 hours", verify: DPDP_RULES_VERIFY + "; confirm the 72-hour period and who may extend it" },
  R8: { topic: "when the specified purpose is deemed no longer served — the erasure clock and the advance warning before erasure", verify: DPDP_RULES_VERIFY },
  "R8(3)": { topic: "retain the logs and associated data for one year after erasure", verify: DPDP_RULES_VERIFY + "; confirm the one-year retention sits in this sub-rule" },
  R9: { topic: "publishing the contact details of the person who answers questions about processing", verify: DPDP_RULES_VERIFY },
  R10: { topic: "verifiable consent of a parent — due diligence that the person is an identifiable adult", verify: DPDP_RULES_VERIFY },
  R12: { topic: "exemptions for certain classes and purposes when processing a child's data (the Schedule that covers educational institutions)", verify: DPDP_RULES_VERIFY + "; confirm the Schedule number and its wording for educational institutions" },
  "R14(1)": { topic: "how a Data Principal makes a request or grievance — the means the Data Fiduciary must publish", verify: DPDP_RULES_VERIFY },
  "R14(3)": { topic: "the time period to respond to a grievance — 90 days", verify: DPDP_RULES_VERIFY + "; confirm the 90-day period and the sub-rule" },
  R15: { topic: "transfer of personal data outside India — subject to the Central Government's requirements", verify: DPDP_RULES_VERIFY },
}

const SPDI_TOPICS: Record<string, Topic> = {
  R3: { topic: "what counts as sensitive personal data or information — passwords, financial details, health, medical records, biometric information" },
  R4: { topic: "a body corporate must publish a privacy policy on its website" },
  "R5(1)": { topic: "consent in writing before collecting sensitive personal data", verify: "confirm the sub-rule number for written consent" },
  "R5(3)": { topic: "tell the person, at collection, that data is being collected, why, who will receive it and who holds it", verify: "confirm the sub-rule number for the collection notice" },
  "R5(9)": { topic: "designate a Grievance Officer, publish the name and contact details on the website, and resolve grievances within one month", verify: "confirm the sub-rule number for the Grievance Officer and the one-month period" },
  R7: { topic: "transfer of information only to a party that ensures the same level of protection, and only where necessary for a contract or with consent" },
  R8: { topic: "reasonable security practices and procedures — a documented security programme such as IS/ISO/IEC 27001" },
}

const AADHAAR_TOPICS: Record<string, Topic> = {
  "§29": { topic: "restrictions on sharing, publishing and displaying Aadhaar numbers and biometric information", verify: "confirm the sub-section relied on for masking, and whether the UIDAI masking circular or the Aadhaar (Sharing of Information) Regulations, 2016 should be cited alongside" },
}

function refToWords(ref: string): string {
  if (ref.startsWith("§")) return `section ${ref.slice(1)}`
  if (ref.startsWith("R")) return `rule ${ref.slice(1)}`
  return ref
}

export type Citation = {
  code: string
  family: string
  instrument: string | null
  reference: string
  short: string
  full: string
  topic: string | null
  verify: string | null
  inForce: string
}

/** Expand one library law code ("d:§8(9)") into words. Returns null for a code that is not `family:ref`. */
export function citeLawCode(code: string): Citation | null {
  const m = /^([a-z]):(.*)$/.exec(code)
  if (!m) return null
  const [, family, ref] = m
  const law = LAWS[family]
  if (!law) return null
  if (family === "g") {
    return { code, family, instrument: null, reference: "", short: law.label, full: law.title, topic: null, verify: null, inForce: law.title }
  }
  let instrument: string | undefined
  let topics: Record<string, Topic> = {}
  if (family === "d") {
    if (ref.startsWith("§")) { instrument = ACT_NAMES.dAct; topics = DPDP_ACT_TOPICS }
    else if (ref.startsWith("R")) { instrument = ACT_NAMES.dRules; topics = DPDP_RULES_TOPICS }
  } else if (family === "s") {
    if (ref.startsWith("R")) { instrument = ACT_NAMES.sRules; topics = SPDI_TOPICS }
    else if (ref.startsWith("§")) { instrument = ACT_NAMES.sAct }
  } else if (family === "a") {
    if (ref.startsWith("§")) { instrument = ACT_NAMES.aAct; topics = AADHAAR_TOPICS }
  }
  if (!instrument) return null
  const known = topics[ref]
  const shortInstrument = family === "d"
    ? (ref.startsWith("§") ? "DPDP Act 2023" : "DPDP Rules 2025")
    : family === "s" ? ACT_NAMES.sRulesShort : ACT_NAMES.aActShort
  return {
    code,
    family,
    instrument,
    reference: refToWords(ref),
    short: `${shortInstrument} ${ref.startsWith("§") ? ref : ref.replace(/^R/, "rule ")}`,
    full: `${instrument}, ${refToWords(ref)}`,
    topic: known ? known.topic : null,
    verify: known ? known.verify ?? null : `no topic label recorded for ${refToWords(ref)} of the ${instrument} — confirm the number and what it provides`,
    inForce: law.title,
  }
}
