// WO-DPDP-012 §5: the law-citation table the job-page generator reads.
//
// Every `law_codes` entry in data/dpdp-library-0.2-wo010.json is a short
// code ("d:§8(9)", "s:R5(9)", "a:§29", "g:") -- law family + section/rule.
// This file expands each one to its full citation so a generated page can
// cite "the law by section and rule" (§5's own words) without anybody
// retyping a section number by hand per page.
//
// HONESTY RULE FOR THIS FILE: a topic label is attached to a section or rule
// only where the author was confident of it. Anything less than that carries
// a `verify` note, which the generator renders as a visible "[VERIFY: ...]"
// beside the citation for the reviewing lawyer. The DPDP Rules 2025 were
// renumbered between the January 2025 draft and the notified text, so EVERY
// Rules topic label carries a verify note on purpose -- "an AI answer quoting
// a wrong section number under VERIDIAN's name is worse than no page"
// (WO-012 §5). Do not remove a verify note here; the lawyer removes it in
// review by confirming the number, then the pages regenerate.
//
// The four LAWS entries, PARTS names, AREA_HELP lines and the sensitive
// data-type list are copied VERBATIM from src/lib/dpdp-onepage/view-model.ts
// (the one-page app's normative strings, WO-DPDP-010). drafts.test.ts pins
// them equal to that file's own exports so they cannot drift apart.

export const LAWS = {
  d: { label: "DPDP", title: "DPDP Act 2023 and Rules 2025 — in force from 13 May 2027" },
  s: { label: "SPDI", title: "IT Act §43A and SPDI Rules 2011 — in force TODAY, until 13 May 2027" },
  a: { label: "Aadhaar Act", title: "Aadhaar Act 2016 — in force today" },
  g: { label: "Good practice", title: "Not a legal duty — it keeps the work moving" },
}

// The two in-force phrases WO-012 §5 asks every page to state, exactly as
// the one page words them (LAWS.s.title / LAWS.d.title above).
export const IN_FORCE_TODAY = "in force TODAY, until 13 May 2027"
export const IN_FORCE_2027 = "in force from 13 May 2027"

export const PARTS = [
  { n: 1, name: "Basics" },
  { n: 2, name: "Know your data" },
  { n: 3, name: "Tell people & take consent" },
  { n: 4, name: "Keep it safe" },
  { n: 5, name: "Firms you share data with" },
  { n: 6, name: "Requests & complaints" },
  { n: 7, name: "Sign off" },
]

export const GRIEVANCE_OFFICER_ROLE_TAG = "Grievance Officer (responsible for DPDP policy)"

export const AREA_HELP = {
  [GRIEVANCE_OFFICER_ROLE_TAG]: "answers complaints and looks after the privacy policy — in a small organisation, usually the owner",
  "DPDP coordinator": "keeps this moving and is the one your CA talks to — usually the owner or the office manager",
  "Customer data": "the head of whichever team runs billing or sales",
  "Staff records": "the head of HR, or whoever keeps staff files",
  "Accounts": "the head of accounts",
  "All staff": "every employee — paste all their emails; each answers for their own laptop and phone",
  "Website firm": "the company that built or runs your website",
  "Payroll firm": "the outside company that runs your payroll",
  "Group company": "a sister or group company you share data with — legally a separate company",
  "CCTV": "whoever is in charge of the cameras",
  "IT & computers": "whoever looks after your computers, passwords and backups — often an outside IT person",
  "Admission office": "the admission office — they hold most student records",
  "Fees office": "the fees office",
  "Teachers": "every teacher — paste all their emails",
  "Transport in-charge": "whoever manages the buses and pickup lists",
  "Bus firm": "the company that runs your school buses",
  "School software firm": "the company behind your school ERP or app",
}

// Role tags that are people, not areas, in the library (firm-29..31,
// institution-28). Not in AREA_HELP because the one page never asks "who
// looks after this" for them -- they are the sign-off chain itself.
export const ROLE_TAG_HELP = {
  OWNER: "the owner or head of the organisation — the person who signs for the whole file",
  CAMGR: "the manager at the CA firm that looks after this file",
  CAPARTNER: "the partner at the CA firm who signs the file",
}

export const AREA_CAN_MARK_NA = ["Website firm", "Payroll firm", "Group company", "CCTV", "Bus firm", "School software firm", "Transport in-charge"]

export const SENSITIVE_DATA_TYPES = [
  "Aadhaar", "Bank details", "Bank account", "Medical", "Health", "Fingerprint", "Face",
  "Children’s photos", "Live location", "Category",
]

export const ACT_NAMES = {
  dAct: "Digital Personal Data Protection Act, 2023",
  dRules: "Digital Personal Data Protection Rules, 2025",
  sAct: "Information Technology Act, 2000",
  sRules: "Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011",
  sRulesShort: "SPDI Rules 2011",
  aAct: "Aadhaar (Targeted Delivery of Financial and Other Subsidies, Benefits and Services) Act, 2016",
  aActShort: "Aadhaar Act 2016",
}

// Topic labels, keyed by the exact reference text after the family prefix.
// `topic` is what the page says the provision is about; `verify` (if set)
// is rendered verbatim inside "[VERIFY: ...]" for the lawyer. A reference
// with no entry here still gets its full citation -- it just carries a
// generic verify note asking the lawyer to confirm the number and topic.
const DPDP_ACT_TOPICS = {
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
const DPDP_RULES_TOPICS = {
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

const SPDI_TOPICS = {
  R3: { topic: "what counts as sensitive personal data or information — passwords, financial details, health, medical records, biometric information" },
  R4: { topic: "a body corporate must publish a privacy policy on its website" },
  "R5(1)": { topic: "consent in writing before collecting sensitive personal data", verify: "confirm the sub-rule number for written consent" },
  "R5(3)": { topic: "tell the person, at collection, that data is being collected, why, who will receive it and who holds it", verify: "confirm the sub-rule number for the collection notice" },
  "R5(9)": { topic: "designate a Grievance Officer, publish the name and contact details on the website, and resolve grievances within one month", verify: "confirm the sub-rule number for the Grievance Officer and the one-month period" },
  R7: { topic: "transfer of information only to a party that ensures the same level of protection, and only where necessary for a contract or with consent" },
  R8: { topic: "reasonable security practices and procedures — a documented security programme such as IS/ISO/IEC 27001" },
}

const AADHAAR_TOPICS = {
  "§29": { topic: "restrictions on sharing, publishing and displaying Aadhaar numbers and biometric information", verify: "confirm the sub-section relied on for masking, and whether the UIDAI masking circular or the Aadhaar (Sharing of Information) Regulations, 2016 should be cited alongside" },
}

function refToWords(ref) {
  // "§8(9)" -> "section 8(9)"; "R6(1)(c)" -> "rule 6(1)(c)"
  if (ref.startsWith("§")) return `section ${ref.slice(1)}`
  if (ref.startsWith("R")) return `rule ${ref.slice(1)}`
  return ref
}

/**
 * Expand one library law code into a citation object:
 *   { code, family, ref, short, full, topic, verify, inForce }
 * Throws on an unknown family so a new code in the library can never
 * silently produce an uncited page.
 */
export function citeLawCode(code) {
  const m = /^([a-z]):(.*)$/.exec(code)
  if (!m) throw new Error(`law code is not "family:ref": ${JSON.stringify(code)}`)
  const [, family, ref] = m
  const law = LAWS[family]
  if (!law) throw new Error(`unknown law family ${JSON.stringify(family)} in code ${JSON.stringify(code)}`)

  if (family === "g") {
    return { code, family, ref: "", short: law.label, full: law.title, topic: null, verify: null, inForce: law.title }
  }

  let instrument, topics
  if (family === "d") {
    if (ref.startsWith("§")) { instrument = ACT_NAMES.dAct; topics = DPDP_ACT_TOPICS }
    else if (ref.startsWith("R")) { instrument = ACT_NAMES.dRules; topics = DPDP_RULES_TOPICS }
  } else if (family === "s") {
    if (ref.startsWith("R")) { instrument = ACT_NAMES.sRules; topics = SPDI_TOPICS }
    else if (ref.startsWith("§")) { instrument = ACT_NAMES.sAct; topics = {} }
  } else if (family === "a") {
    if (ref.startsWith("§")) { instrument = ACT_NAMES.aAct; topics = AADHAAR_TOPICS }
  }
  if (!instrument) throw new Error(`cannot cite ${JSON.stringify(code)}: unrecognised reference form`)

  const known = topics[ref]
  const topic = known ? known.topic : null
  const verify = known
    ? known.verify ?? null
    : `no topic label recorded for ${refToWords(ref)} of the ${instrument} — confirm the number and what it provides`
  const shortInstrument = family === "d"
    ? (ref.startsWith("§") ? "DPDP Act 2023" : "DPDP Rules 2025")
    : family === "s" ? ACT_NAMES.sRulesShort : ACT_NAMES.aActShort

  return {
    code,
    family,
    ref,
    shortInstrument,
    refText: ref.startsWith("§") ? ref : ref.replace(/^R/, ""),
    isRule: ref.startsWith("R"),
    short: `${shortInstrument} ${ref.startsWith("§") ? ref : ref.replace(/^R/, "rule ")}`,
    full: `${instrument}, ${refToWords(ref)}`,
    topic,
    verify,
    inForce: law.title,
  }
}

/** isToday(codes): true if any law code is SPDI ('s') or Aadhaar Act ('a') -- the one page's own rule (view-model.ts). */
export function isToday(codes) {
  return (codes ?? []).some((c) => c[0] === "s" || c[0] === "a")
}

export function hasDpdp(codes) {
  return (codes ?? []).some((c) => c[0] === "d")
}

export function isGoodPracticeOnly(codes) {
  const cs = codes ?? []
  return cs.length > 0 && cs.every((c) => c[0] === "g")
}
