// WO-DPDP-012 §5 guides -- "one question each", answer-first, English.
//
// These are DRAFTS for the lawyer. The rule of this file: cite the DPDP Act
// 2023 and the DPDP Rules 2025 by section and rule only where the author was
// confident, and put "[VERIFY: ...]" beside anything less than that. The
// DPDP Rules were renumbered between the January 2025 draft and the
// notified text, so every Rules number here is flagged. No case law is
// cited anywhere, deliberately: there is none the author could stand
// behind, and an invented citation under VERIDIAN's name is worse than no
// page (§5's own words).
//
// Each guide is a function of the library so that the "what done looks
// like" section lists the real jobs (by key and plain text, never retyped)
// that implement the guide's answer -- when the library changes, so do the
// lists.

import { GRIEVANCE_OFFICER_ROLE_TAG, LAWS } from "./law.mjs"
import { describe } from "./render.mjs"

const DATE = "2026-09-22" // drafting date; dateModified moves only when a guide's text changes

const RULES_VERIFY = "rule numbers changed between the January 2025 draft and the notified DPDP Rules 2025 — confirm against the notified text"

function jobsWhere(lib, pred) {
  return lib.templates.filter(pred).map((t) => `${t.key} — ${t.plain_text}`)
}

function guide({ slug, title, h1, kicker, answer, sections, hasHindi }) {
  return {
    lang: "en-IN",
    slug,
    path: `/guides/${slug}/`,
    title: `${title} | VERIDIAN`,
    description: describe(answer.slice(0, 2)),
    h1,
    kicker,
    answer,
    sections,
    breadcrumbs: [{ name: "Guides", path: "/guides/" }],
    datePublished: DATE,
    dateModified: DATE,
    alternates: hasHindi
      ? [
        { hreflang: "en-IN", href: `https://app.veridian-aios.com/guides/${slug}/` },
        { hreflang: "hi", href: `https://app.veridian-aios.com/hi/guides/${slug}/` },
        { hreflang: "x-default", href: `https://app.veridian-aios.com/guides/${slug}/` },
      ]
      : [],
    headerComment: [
      "UNPUBLISHED DRAFT -- WO-DPDP-012 §5 guide. Publish nothing legal until the owner confirms lawyer review.",
      "Every [VERIFY: ...] on this page is a question for the reviewing lawyer; the page is not publishable while one remains.",
    ].join("\n"),
  }
}

export function guidesEn(lib) {
  const firmCount = lib.templates.filter((t) => t.product === "firm").length
  const schoolCount = lib.templates.filter((t) => t.product === "institution").length

  return [
    guide({
      slug: "what-the-dpdp-act-asks",
      hasHindi: true,
      title: "What the DPDP Act asks, in one page",
      h1: "What the DPDP Act asks, in one page",
      kicker: "Guide · Digital Personal Data Protection Act, 2023 · one question: what does the Act actually require of an organisation?",
      answer: [
        "The DPDP Act asks anyone who decides why and how personal data is used — a Data Fiduciary — to collect it only for a lawful purpose with consent or a listed legitimate use, tell people what is collected and why, keep it safe, delete it when it is no longer needed, publish who answers questions about it, and honour people's rights to see, correct, erase and complain.",
        "Most of these duties take effect on 13 May 2027, when the DPDP Rules 2025 bring the Act's substantive provisions into force; until then the SPDI Rules 2011 under the IT Act are the law in force.",
        "Below is every duty, by section, in the order the Act lists them.",
      ],
      sections: [
        {
          h2: "Who the Act applies to",
          blocks: [
            { type: "ul", items: [
              "Digital personal data — data about an identifiable person, collected in digital form or digitised afterwards (section 3).",
              "Processing within India, and processing outside India that is connected with offering goods or services to people in India (section 3).",
              "Not: personal data a person processes for personal or domestic purposes, or that the person has themselves made publicly available (section 3).",
              { text: "There is no size exemption in the Act. A ten-person firm holding customer phone numbers is a Data Fiduciary.", note: "[VERIFY: section 17(3) lets the Central Government exempt notified classes such as start-ups from some sections — confirm whether any notification in force affects small organisations]" },
            ] },
          ],
        },
        {
          h2: "The law, by section and rule — the duties in the Act's own order",
          blocks: [
            { type: "ol", items: [
              "Lawful purpose (section 4): process personal data only for a lawful purpose, and only with the person's consent or under one of the legitimate uses in section 7.",
              "Notice (section 5): before or when asking for consent, tell the person what personal data you want, for what purpose, how they can exercise their rights, and how they can complain to the Board.",
              { text: "Consent (section 6): free, specific, informed, unconditional and unambiguous, given by a clear affirmative action; withdrawing it must be as easy as giving it.", note: "[VERIFY: section 6(4) as the ease-of-withdrawal sub-section]" },
              "Legitimate uses (section 7): consent is not needed for the listed uses — including data a person gave voluntarily for a stated purpose (7(a)) and processing for the purposes of employment (7(i)).",
              { text: "General obligations (section 8): stay responsible for compliance whatever any contract says (8(1)); engage a Data Processor only under a valid contract (8(2)); keep data complete and accurate where it drives a decision or is passed on (8(3)); take technical and organisational measures (8(4)); keep reasonable security safeguards against a breach (8(5)); tell the Board and each affected person about a breach (8(6)); erase personal data when consent is withdrawn or the purpose is served, and make the processor erase it too, unless a law requires retention (8(7)); publish the contact of the person who answers questions (8(9)); run an effective grievance mechanism (8(10)).", note: "[VERIFY: the sub-section numbers 8(9) and 8(10) in the enacted text]" },
              "Children (section 9): verifiable consent of a parent or lawful guardian before processing a child's personal data (9(1)); no processing likely to harm a child's well-being (9(2)); no tracking, behavioural monitoring or targeted advertising directed at children (9(3)).",
              { text: "Significant Data Fiduciaries (section 10): a notified large or high-risk fiduciary must appoint a Data Protection Officer based in India, an independent data auditor, and carry out periodic impact assessments. Most small organisations will never be notified.", note: "[VERIFY: section 10(2) items]" },
            ] },
          ],
        },
        {
          h2: "The rights the Act gives people",
          blocks: [
            { type: "ul", items: [
              "Access (section 11): a summary of the personal data held and the processing done, and the identities of everyone it was shared with.",
              "Correction and erasure (section 12): correct, complete, update — and erase, unless retention is needed for the stated purpose or required by law.",
              { text: "Grievance redressal (section 13): a readily available means of grievance redressal, and a response within the period the Rules prescribe — 90 days.", note: `[VERIFY: the 90-day period and its rule number; ${RULES_VERIFY}]` },
              "Nomination (section 14): a person may nominate someone to exercise these rights if they die or become incapacitated.",
              "Duties of the person (section 15): no false or frivolous complaints, no impersonation, no suppressing material information.",
            ] },
          ],
        },
        {
          h2: "In force today, or from 13 May 2027?",
          blocks: [
            { type: "ul", items: [LAWS.d.title, LAWS.s.title] },
            { type: "p", text: "The Act was passed in August 2023. The DPDP Rules 2025 were notified in November 2025 with phased commencement; the duties above commence eighteen months after notification, on 13 May 2027. [VERIFY: the commencement notification, the phasing, and the exact date] Until then, the SPDI Rules 2011 are the law you can be held to today." },
          ],
        },
        {
          h2: "Who usually does it",
          blocks: [
            { type: "p", text: `The owner, with a named Grievance Officer — ${"answers complaints and looks after the privacy policy — in a small organisation, usually the owner"} — and a DPDP coordinator who keeps this moving. In a school the admission office holds most of the data; in a company, whoever runs billing and whoever keeps staff files.` },
          ],
        },
        {
          h2: "What proof looks like",
          blocks: [
            { type: "p", text: "One dated, attributable record per duty: who did it, when, and what page or document it produced. The Act puts the burden of proving that consent was given on the Data Fiduciary [VERIFY: section 6(10)], so the record is not optional." },
          ],
        },
        {
          h2: "Why it matters",
          blocks: [
            { type: "p", text: "From 13 May 2027 a person can take an unresolved grievance to the Data Protection Board of India, which can inquire and impose the penalties set by the Act's Schedule. No penalty order has been issued in India to date, and the Board's members are not yet appointed. The date is the real thing, not the fear." },
          ],
        },
        {
          h2: "What done looks like",
          blocks: [
            { type: "p", text: `VERIDIAN's job library (version ${lib.version}) turns the sections above into ${firmCount} jobs for a company, firm or NGO and ${schoolCount} for a school — each with a named person, a date and a proof. Done is every job answered and the file signed off by the owner.` },
          ],
        },
      ],
    }),

    guide({
      slug: "what-applies-today-spdi-rules-2011",
      hasHindi: true,
      title: "What applies today: the SPDI Rules 2011 until 13 May 2027",
      h1: "What applies today: the SPDI Rules 2011 until 13 May 2027",
      kicker: "Guide · Information Technology Act, 2000, section 43A and the SPDI Rules 2011 · one question: which data-protection law can I be held to right now?",
      answer: [
        "Until 13 May 2027, the law that governs personal data held by a company, firm or professional practice in India is section 43A of the Information Technology Act, 2000 and the SPDI Rules 2011 made under it — not yet the DPDP Act.",
        "They ask a body corporate to publish a privacy policy (rule 4), take consent in writing before collecting sensitive personal data (rule 5(1)), tell people at collection what is collected and why (rule 5(3)), name a Grievance Officer who resolves complaints within one month (rule 5(9)), transfer data only to parties with the same level of protection (rule 7), and keep reasonable security practices (rule 8). [VERIFY: each sub-rule number]",
        "The one page marks these jobs 'required by today's law': they are late the day they are missed, not on 13 May 2027.",
      ],
      sections: [
        {
          h2: "The law, by section and rule",
          blocks: [
            { type: "ul", items: [
              "Information Technology Act, 2000, section 43A — a body corporate that is negligent in implementing and maintaining reasonable security practices while handling sensitive personal data, and thereby causes wrongful loss or gain, is liable to pay compensation to the person affected.",
              "SPDI Rules 2011, rule 3 — what counts as sensitive personal data or information: passwords, financial information such as bank account and card details, physical, physiological and mental health condition, sexual orientation, medical records and history, biometric information.",
              "SPDI Rules 2011, rule 4 — a body corporate that collects, receives, stores or handles personal information must publish a privacy policy on its website: the type of information collected, the purpose, the disclosure practices, and the security practices followed.",
              { text: "SPDI Rules 2011, rule 5 — collection: consent in writing before collecting sensitive personal data (5(1)); collect only for a lawful purpose connected with a function of the body corporate (5(2)); tell the person that data is being collected, why, who the intended recipients are, and who holds it (5(3)); keep it no longer than needed (5(4)); allow the person to review and correct it (5(6)); give the option to withdraw consent (5(7)); designate a Grievance Officer, publish the name and contact details on the website, and redress grievances within one month (5(9)).", note: "[VERIFY: every sub-rule number in this line]" },
              { text: "SPDI Rules 2011, rule 6 — disclosure to a third party needs the person's prior permission, unless agreed in the contract or required by law.", note: "[VERIFY: rule 6 wording]" },
              "SPDI Rules 2011, rule 7 — transfer of sensitive personal data, in India or abroad, only to a body corporate that ensures the same level of protection, and only where necessary for a lawful contract or with consent.",
              { text: "SPDI Rules 2011, rule 8 — reasonable security practices: a documented security programme with managerial, technical, operational and physical controls; IS/ISO/IEC 27001 is the named standard, audited by an approved auditor at least once a year or after a significant upgrade.", note: "[VERIFY: the annual-audit wording in rule 8(4)]" },
            ] },
          ],
        },
        {
          h2: "Who it applies to",
          blocks: [
            { type: "p", text: "'Body corporate' means any company, and includes a firm, sole proprietorship or other association of individuals engaged in commercial or professional activities (the explanation to section 43A). A CA, CS, audit or legal practice is squarely inside that. A school run as a trust or society is not obviously a body corporate engaged in commercial activity. [VERIFY: whether the SPDI Rules reach a non-commercial school]" },
            { type: "p", text: `VERIDIAN's school library (version ${lib.version}) therefore carries no SPDI-tagged jobs at all; a school's 'today' jobs come from the Aadhaar Act 2016 only. [VERIFY: that this treatment of schools is right — if a school is a body corporate, its Grievance Officer, consent and security jobs should carry SPDI tags too]` },
          ],
        },
        {
          h2: "In force today, or from 13 May 2027?",
          blocks: [
            { type: "ul", items: [LAWS.s.title, LAWS.d.title] },
            { type: "p", text: "The DPDP Act omits section 43A of the IT Act when the corresponding DPDP provisions commence (section 44(2)). [VERIFY: section 44(2) and the date it takes effect] Until that day both regimes are on the statute book, but only section 43A and the SPDI Rules can be enforced against you." },
          ],
        },
        {
          h2: "Who usually does it",
          blocks: [
            { type: "p", text: "The Grievance Officer — answers complaints and looks after the privacy policy — in a small organisation, usually the owner — together with whoever looks after your computers, passwords and backups (often an outside IT person) for rule 8, and the company that built or runs your website for rule 4." },
          ],
        },
        {
          h2: "What proof looks like",
          blocks: [
            { type: "ul", items: [
              "The privacy policy's URL and the date it went up (rule 4).",
              "The written consent — a signed form or the email — for each sensitive data type you hold (rule 5(1)).",
              "The Grievance Officer's name and contact on the website, or on a free VERIDIAN page (rule 5(9)), and a complaint register with dates in and out.",
              "The signed agreement with each outside firm that receives the data (rule 7).",
              "A written security programme — passwords, access limits, backups — or the ISO/IEC 27001 certificate if you have one (rule 8).",
            ] },
          ],
        },
        {
          h2: "Why it matters",
          blocks: [
            { type: "p", text: "This is the law you can be held to today. A person harmed by negligent security can claim compensation under section 43A, before the Adjudicating Officer appointed under section 46 of the IT Act. [VERIFY: the forum and its monetary limit] The DPDP Board does not exist for this purpose until 13 May 2027." },
          ],
        },
        {
          h2: "What done looks like",
          blocks: [
            { type: "p", text: "These are the library jobs that carry an SPDI tag — the ones the one page counts as required by today's law:" },
            { type: "ul", items: jobsWhere(lib, (t) => (t.law_codes ?? []).some((c) => c.startsWith("s:"))) },
          ],
        },
      ],
    }),

    guide({
      slug: "dpdp-for-schools-section-9-exemption",
      hasHindi: true,
      title: "DPDP for schools: why the §9 exemption does not cover admission data",
      h1: "DPDP for schools: why the §9 exemption does not cover admission data",
      kicker: "Guide · Digital Personal Data Protection Act, 2023, section 9 · one question: does the school exemption mean we do not need parental consent?",
      answer: [
        "Section 9 of the DPDP Act requires a school to obtain the verifiable consent of a parent or lawful guardian before processing a child's personal data (9(1)), and forbids tracking, behavioural monitoring and targeted advertising directed at children (9(3)).",
        "The DPDP Rules 2025 exempt educational institutions from those two requirements only for processing that is restricted to educational activities and the safety of the child — attendance, in-school location, a learning platform's progress record [VERIFY: the rule number and the Schedule's wording for educational institutions]; admission data — name, date of birth, address, Aadhaar, category, health — is collected to enrol the child, not to keep it safe or teach it, so the exemption does not reach it and verifiable parental consent, with a notice, is still needed.",
        "Everything else in the Act — security, breach intimation, erasure, the published contact, grievances — applies to a school in full, exemption or not.",
      ],
      sections: [
        {
          h2: "The law, by section and rule",
          blocks: [
            { type: "ul", items: [
              { text: "Digital Personal Data Protection Act, 2023, section 2 — a 'child' is a person who has not completed eighteen years of age.", note: "[VERIFY: the clause letter of the definition]" },
              "Digital Personal Data Protection Act, 2023, section 9(1) — before processing a child's personal data, obtain the verifiable consent of the parent or lawful guardian.",
              "Digital Personal Data Protection Act, 2023, section 9(2) — no processing that is likely to cause a detrimental effect on the well-being of a child.",
              "Digital Personal Data Protection Act, 2023, section 9(3) — no tracking or behavioural monitoring of children, and no targeted advertising directed at them.",
              { text: "Digital Personal Data Protection Act, 2023, section 9(4) — the Rules may exempt classes of Data Fiduciaries, or purposes, from 9(1) and 9(3), subject to conditions.", note: "[VERIFY: sub-section number]" },
              { text: "Digital Personal Data Protection Rules, 2025, rule 10 — verifiable consent: due diligence that the person giving consent is an identifiable adult, by reliable identity and age details or a virtual token.", note: `[VERIFY: ${RULES_VERIFY}]` },
              { text: "Digital Personal Data Protection Rules, 2025, rule 12 and its Schedule — the exemption for educational institutions, limited to educational activities and the safety of the child.", note: `[VERIFY: ${RULES_VERIFY}; confirm the Schedule number and the exact words used for educational institutions]` },
              "Digital Personal Data Protection Act, 2023, section 5 — the notice to the parent still applies; and section 8 — the school's general obligations apply in full.",
            ] },
          ],
        },
        {
          h2: "What the exemption does and does not cover",
          blocks: [
            { type: "p", text: "Covered by the exemption, as the Rules describe it [VERIFY: wording]:" },
            { type: "ul", items: [
              "Behavioural monitoring restricted to educational activities — a learning platform recording progress, a teacher's attendance record.",
              "Tracking of location restricted to the safety of the child — where the child is on the premises, on the school bus during the journey.",
            ] },
            { type: "p", text: "Not covered — verifiable parental consent, and the section 5 notice, are still needed:" },
            { type: "ul", items: [
              "The admission form and everything on it: name, date of birth, address, Aadhaar, category, health details.",
              "Fee records that link a parent's occupation and income to the child.",
              "Photographs and videos of children used on the website, in the magazine or on social media — a separate yes or no from the parent, for that use.",
              "Bus tracking that continues outside the journey, or that is shared with anyone but the school and the parent.",
              "Marks or attendance shared with a third party, or used to profile a child for anything but teaching.",
              "Any advertising directed at the child — this is banned outright, with no consent route.",
            ] },
          ],
        },
        {
          h2: "In force today, or from 13 May 2027?",
          blocks: [
            { type: "ul", items: [LAWS.d.title, LAWS.a.title] },
            { type: "p", text: "Section 9 and its exemption take effect on 13 May 2027 with the rest of the Act's substantive duties. [VERIFY: commencement date] The Aadhaar Act's restrictions on storing and displaying Aadhaar numbers apply today, so masking Aadhaar copies on admission files is a today job. The SPDI Rules 2011 are written for a 'body corporate' engaged in commercial or professional activity, and VERIDIAN's school library carries no SPDI jobs. [VERIFY: whether a school run by a trust or society is a body corporate for the SPDI Rules]" },
          ],
        },
        {
          h2: "Who usually does it",
          blocks: [
            { type: "p", text: "The admission office — they hold most student records — takes the consent and gives the notice; the DPDP coordinator — keeps this moving and is the one your CA talks to — usually the owner or the office manager — runs the separate photo yes-or-no; the Grievance Officer answers parents' questions." },
          ],
        },
        {
          h2: "What proof looks like",
          blocks: [
            { type: "ul", items: [
              "The admission consent, signed by the parent, with the record of how the school checked that the signer is an adult and the parent (rule 10) [VERIFY: rule number].",
              "The notice to parents — what the school holds, why, and how to complain — on the admission form and the website.",
              "The separate photo consent, itemised: website, magazine, social media, each a yes or a no.",
              "The bus firm's signed data agreement: location only during the journey, only for safety.",
            ] },
          ],
        },
        {
          h2: "Why it matters",
          blocks: [
            { type: "p", text: "Most of the personal data a school holds belongs to minors, and section 9 is the Act's own heightened duty for exactly that. From 13 May 2027 a parent can take an unresolved grievance to the Data Protection Board of India; the Schedule to the Act lists a separate, higher ceiling for breaches of the children's provisions — this page does not quote figures, the Board decides each case." },
          ],
        },
        {
          h2: "What done looks like",
          blocks: [
            { type: "p", text: "These are the school library jobs that carry a section 9 tag:" },
            { type: "ul", items: jobsWhere(lib, (t) => t.product === "institution" && (t.law_codes ?? []).some((c) => c.startsWith("d:§9"))) },
          ],
        },
      ],
    }),

    guide({
      slug: "grievance-officer-what-the-law-requires",
      hasHindi: true,
      title: "The Grievance Officer: what the law requires",
      h1: "The Grievance Officer: what the law requires",
      kicker: "Guide · SPDI Rules 2011, rule 5(9) and DPDP Act 2023, section 8(9)–(10) · one question: do we have to appoint and publish a Grievance Officer?",
      answer: [
        "Today, rule 5(9) of the SPDI Rules 2011 requires every body corporate that handles sensitive personal data to designate a Grievance Officer, publish that officer's name and contact details on its website, and redress grievances within one month of receiving them. [VERIFY: the sub-rule number and the one-month period]",
        "From 13 May 2027, the DPDP Act asks for the same thing under different names: publish the business contact information of the person who can answer questions about your processing (section 8(9)), run an effective grievance mechanism (section 8(10)), and respond to a grievance within the period the Rules prescribe — 90 days [VERIFY: sections 8(9) and 8(10), and the 90-day rule number].",
        "The Act itself never uses the title 'Grievance Officer'; VERIDIAN keeps the SPDI title because it is the one people know, and because one named person can satisfy both laws.",
      ],
      sections: [
        {
          h2: "The law, by section and rule",
          blocks: [
            { type: "ul", items: [
              { text: "SPDI Rules 2011, rule 5(9) — designate a Grievance Officer; publish the name and contact details on the website; redress grievances expeditiously, and within one month.", note: "[VERIFY: sub-rule number]" },
              { text: "Digital Personal Data Protection Act, 2023, section 8(9) — publish, in the prescribed manner, the business contact information of a Data Protection Officer if there is one, or of a person able to answer the person's questions about the processing.", note: "[VERIFY: sub-section number]" },
              { text: "Digital Personal Data Protection Act, 2023, section 8(10) — establish an effective mechanism to redress grievances.", note: "[VERIFY: sub-section number]" },
              "Digital Personal Data Protection Act, 2023, section 13 — the person's right to a readily available means of grievance redressal, and a response within the prescribed period; the Board can be approached only after that route is exhausted.",
              { text: "Digital Personal Data Protection Rules, 2025, rule 9 — how the contact is published.", note: `[VERIFY: ${RULES_VERIFY}]` },
              { text: "Digital Personal Data Protection Rules, 2025, rule 14 — the means of making a request must be published (14(1)); a grievance must be answered within 90 days (14(3)).", note: `[VERIFY: ${RULES_VERIFY}; confirm the 90 days]` },
              { text: "Digital Personal Data Protection Act, 2023, section 10(2)(a) — a Data Protection Officer is required only of a Significant Data Fiduciary, notified by the Central Government.", note: "[VERIFY: clause reference]" },
            ] },
          ],
        },
        {
          h2: "Grievance Officer, Data Protection Officer, or 'a person able to answer'?",
          blocks: [
            { type: "ul", items: [
              "Grievance Officer — the SPDI Rules' title, in force today, required of every body corporate handling sensitive personal data.",
              "A person able to answer — the DPDP Act's phrase for the same role in an ordinary organisation, from 13 May 2027; no title is prescribed.",
              "Data Protection Officer — only for a Significant Data Fiduciary, which the Central Government must notify; a small company or a school will not normally be one.",
            ] },
            { type: "p", text: "One named person, published once, satisfies all three for a small organisation. Naming them is the first job in the file because nothing else works without it." },
          ],
        },
        {
          h2: "In force today, or from 13 May 2027?",
          blocks: [
            { type: "ul", items: [LAWS.s.title, LAWS.d.title] },
            { type: "p", text: "Under today's law the answer must come within one month; under the DPDP Rules, within 90 days. [VERIFY: both periods] The one page keeps the shorter clock until 13 May 2027." },
          ],
        },
        {
          h2: "Who usually does it",
          blocks: [
            { type: "p", text: `${GRIEVANCE_OFFICER_ROLE_TAG} — answers complaints and looks after the privacy policy — in a small organisation, usually the owner.` },
          ],
        },
        {
          h2: "What proof looks like",
          blocks: [
            { type: "ul", items: [
              "The appointment: a dated declaration naming the person, in the VERIDIAN record.",
              "The publication: the page on your own website, or the free VERIDIAN page, showing the name and contact — with its URL and the date it went up.",
              "The register: each complaint with the date it arrived and the date it was answered, so the one-month or 90-day clock can be shown to have been met.",
            ] },
          ],
        },
        {
          h2: "Why it matters",
          blocks: [
            { type: "p", text: "Under the DPDP Act a person must use your grievance route before going to the Board (section 13). A published officer who answers on time is therefore the thing most likely to keep a complaint from becoming a Board inquiry — and the first thing a reviewer or a Board looks for." },
          ],
        },
        {
          h2: "What done looks like",
          blocks: [
            { type: "p", text: "These are the library jobs the Grievance Officer answers for:" },
            { type: "ul", items: jobsWhere(lib, (t) => t.role_tag === GRIEVANCE_OFFICER_ROLE_TAG) },
          ],
        },
      ],
    }),

    guide({
      slug: "privacy-policy-spdi-rule-4-vs-dpdp-notice-section-5",
      hasHindi: true,
      title: "Privacy policy (SPDI Rule 4) vs DPDP notice (§5)",
      h1: "Privacy policy (SPDI Rule 4) vs DPDP notice (§5)",
      kicker: "Guide · SPDI Rules 2011, rule 4 and DPDP Act 2023, section 5 · one question: is a privacy policy on the website enough?",
      answer: [
        "A privacy policy under SPDI rule 4 is one document on your website that describes your practices — what personal and sensitive data you collect, why, to whom you disclose it, and the security practices you follow; it is required today.",
        "A DPDP notice under section 5 is different: it is given to each person at or before the request for consent, and must say what personal data you want, for what purpose, how the person can exercise their rights, and how they can complain to the Board — in clear and plain language, itemised, and available in English or any of the languages in the Eighth Schedule to the Constitution [VERIFY: section 5(3) or 6(3) for the language option, and the rule that prescribes itemisation].",
        "You need both: the policy stays on the website; the notice goes on the form, the invoice, the admission form and the website page where the data is actually collected.",
      ],
      sections: [
        {
          h2: "The law, by section and rule",
          blocks: [
            { type: "ul", items: [
              "SPDI Rules 2011, rule 4 — the body corporate must publish a privacy policy on its website, covering the type of personal and sensitive personal data collected, the purpose, the disclosure practices, and the reasonable security practices followed.",
              { text: "SPDI Rules 2011, rule 5(3) — at collection, the person must be told that data is being collected, the purpose, the intended recipients, and the name and address of the agency collecting and holding it.", note: "[VERIFY: sub-rule number]" },
              "Digital Personal Data Protection Act, 2023, section 5(1) — every request for consent is accompanied or preceded by a notice: the personal data and the purpose, how to exercise the section 6(4) and section 13 rights, and how to complain to the Board.",
              { text: "Digital Personal Data Protection Act, 2023, section 5(2) — where consent was given before the Act commenced, the notice is given as soon as reasonably practicable.", note: "[VERIFY: sub-section number]" },
              { text: "Digital Personal Data Protection Rules, 2025, rule 3 — the notice must be understandable on its own, itemise the data and the purposes, and give the link to the website or app and the means to exercise rights and complain.", note: `[VERIFY: ${RULES_VERIFY}]` },
              { text: "Digital Personal Data Protection Act, 2023, section 6(3) — the consent request, and the notice with it, in clear and plain language, with the option to read it in English or any language in the Eighth Schedule to the Constitution.", note: "[VERIFY: sub-section number]" },
            ] },
          ],
        },
        {
          h2: "Side by side",
          blocks: [
            { type: "ul", items: [
              "Where it lives — policy: one page on the website. Notice: on every point where data is collected — the form, the invoice, the admission form, the web form, the camera sign.",
              "When it is given — policy: published once, kept current. Notice: at or before each request for consent, and as soon as practicable for data collected before the Act commenced.",
              "What it must say — policy: your practices in general. Notice: the specific data, the specific purpose, how to exercise rights, how to complain to the Board.",
              "Language — policy: no language rule in the SPDI Rules. Notice: clear and plain, with an English or Eighth-Schedule-language option [VERIFY].",
              "Who it is for — policy: the public. Notice: the one person whose data is being asked for.",
            ] },
          ],
        },
        {
          h2: "In force today, or from 13 May 2027?",
          blocks: [
            { type: "ul", items: [LAWS.s.title, LAWS.d.title] },
            { type: "p", text: "The rule 4 policy is required today. The section 5 notice is required from 13 May 2027 — but a notice written now is also the rule 5(3) collection notice today's law asks for, so doing it once serves both. [VERIFY: commencement date and rule 5(3)]" },
          ],
        },
        {
          h2: "Who usually does it",
          blocks: [
            { type: "p", text: "The company that built or runs your website (the policy, and the web-form notice); the head of whichever team runs billing or sales (the notice on forms and invoices); in a school, the DPDP coordinator (the notice to parents) and whoever is in charge of the cameras (the notice wherever there is a camera)." },
          ],
        },
        {
          h2: "What proof looks like",
          blocks: [
            { type: "ul", items: [
              "The policy: its URL, its wording, and the date it went up — VERIDIAN records the document's fingerprint, name and date, never the document.",
              "The notice: the text as it appears on each collection point, and a dated declaration that it is in place.",
              "For existing data: the date the notice was sent to the people already on file.",
            ] },
          ],
        },
        {
          h2: "Why it matters",
          blocks: [
            { type: "p", text: "Without a notice, consent is not informed, and processing that rests on consent has no lawful ground under section 4. A policy nobody reads on the website does not cure that — the notice has to reach the person at the moment the data is asked for." },
          ],
        },
        {
          h2: "What done looks like",
          blocks: [
            { type: "p", text: "These are the library jobs that carry a section 5 or rule 4 tag:" },
            { type: "ul", items: jobsWhere(lib, (t) => (t.law_codes ?? []).some((c) => c === "d:§5" || c === "s:R4")) },
          ],
        },
      ],
    }),

    guide({
      slug: "72-hour-leak-rule-and-90-day-request-rule",
      hasHindi: false,
      title: "The 72-hour leak rule · the 90-day request rule",
      h1: "The 72-hour leak rule · the 90-day request rule",
      kicker: "Guide · DPDP Act 2023, sections 8(6) and 13, with the DPDP Rules 2025 · one question: how long do we have to report a leak, and to answer a request?",
      answer: [
        "From 13 May 2027, when personal data leaks, a Data Fiduciary must tell every affected person without delay, and tell the Data Protection Board without delay and then in detail within 72 hours of becoming aware of the breach [VERIFY: rule 7 — the exact sub-rules, the 72-hour period, and the Board's power to extend it].",
        "Separately, a Data Fiduciary must respond to a person's request or grievance within 90 days [VERIFY: rule 14(3) as the source of the 90 days, read with section 13(2)]; today, under the SPDI Rules, a grievance must be redressed within one month [VERIFY: rule 5(9)].",
        "Today's leak rule is different again: CERT-In's directions of 28 April 2022 require cyber security incidents to be reported to CERT-In within six hours of noticing them [VERIFY: the direction's scope and whether it reaches an ordinary organisation's data leak].",
      ],
      sections: [
        {
          h2: "The law, by section and rule",
          blocks: [
            { type: "ul", items: [
              "Digital Personal Data Protection Act, 2023, section 8(6) — in the event of a personal data breach, give the Board and each affected Data Principal intimation of the breach in the prescribed form and manner.",
              { text: "Digital Personal Data Protection Rules, 2025, rule 7 — on becoming aware of a breach: intimate each affected person without delay, in plain language, with the nature, extent, timing and likely impact, the measures being taken, what the person can do, and a contact; intimate the Board without delay, and give it a detailed report within 72 hours, extendable by the Board on request.", note: `[VERIFY: ${RULES_VERIFY}; confirm each element and the 72-hour period]` },
              "Digital Personal Data Protection Act, 2023, section 13 — a readily available means of grievance redressal, and a response within the prescribed period; the Board may be approached only after this route is exhausted.",
              { text: "Digital Personal Data Protection Rules, 2025, rule 14(3) — the period for responding to a grievance is 90 days.", note: `[VERIFY: ${RULES_VERIFY}; confirm the 90 days and whether rule 14 also governs access and erasure requests]` },
              { text: "SPDI Rules 2011, rule 5(9) — grievances redressed expeditiously, within one month.", note: "[VERIFY: sub-rule number]" },
              { text: "CERT-In directions of 28 April 2022 under section 70B(6) of the Information Technology Act, 2000 — cyber security incidents of the listed types to be reported to CERT-In within six hours of noticing or being informed.", note: "[VERIFY: the direction's date, section reference, the incident types listed, and its application to a small organisation]" },
            ] },
          ],
        },
        {
          h2: "The two clocks, side by side",
          blocks: [
            { type: "ul", items: [
              "A leak, today: report to CERT-In within six hours if it is a listed incident type [VERIFY]; tell the people affected — not required by the SPDI Rules in terms, but the section 43A negligence question turns on what you did next.",
              "A leak, from 13 May 2027: tell each affected person without delay; tell the Board without delay; full report to the Board within 72 hours [VERIFY].",
              "A request or complaint, today: answer within one month (SPDI rule 5(9)) [VERIFY].",
              "A request or complaint, from 13 May 2027: answer within 90 days (DPDP rule 14(3)) [VERIFY].",
            ] },
          ],
        },
        {
          h2: "In force today, or from 13 May 2027?",
          blocks: [
            { type: "ul", items: [LAWS.s.title, LAWS.d.title] },
            { type: "p", text: "The 72-hour rule and the 90-day rule both start on 13 May 2027 [VERIFY: commencement]. The one-month rule and the CERT-In six-hour rule are in force today." },
          ],
        },
        {
          h2: "Who usually does it",
          blocks: [
            { type: "p", text: "The Grievance Officer — answers complaints and looks after the privacy policy — in a small organisation, usually the owner — writes the leak plan and owns the request register; whoever looks after your computers, passwords and backups — often an outside IT person — finds and stops the leak and says who was affected." },
          ],
        },
        {
          h2: "What proof looks like",
          blocks: [
            { type: "ul", items: [
              "The written leak plan: who is told, in what order, by whom, with the intimation wording ready — dated, in the VERIDIAN record.",
              "The data map that lets you work out who is affected in minutes rather than weeks.",
              "The request register: every request or complaint, the date it arrived, the date it was answered.",
              "After a real incident: the intimations themselves, with their timestamps against the clocks above.",
            ] },
          ],
        },
        {
          h2: "Why it matters",
          blocks: [
            { type: "p", text: "A breach that is not reported is the breach the Board is most likely to act on, and the Schedule to the Act lists a separate ceiling for failing to notify — this page does not quote figures. A request answered late is a grievance the person may take to the Board once your route is exhausted (section 13)." },
          ],
        },
        {
          h2: "What done looks like",
          blocks: [
            { type: "p", text: "These are the library jobs that carry a breach, grievance-response or request tag:" },
            { type: "ul", items: jobsWhere(lib, (t) => (t.law_codes ?? []).some((c) => ["d:§8(6)", "d:R7", "d:§13", "d:R14(3)"].includes(c))) },
          ],
        },
      ],
    }),

    guide({
      slug: "dpdp-for-ca-firms-your-own-file-and-your-clients",
      hasHindi: false,
      title: "DPDP for CA firms: your own file and your clients'",
      h1: "DPDP for CA firms: your own file and your clients'",
      kicker: "Guide · DPDP Act 2023, sections 2, 7(i) and 8 · one question: is a CA firm a Data Fiduciary or a Data Processor?",
      answer: [
        "A CA, CS, audit or legal firm holds two DPDP positions at once: for its own staff, its own clients' contact people and its own website it is a Data Fiduciary with the full set of duties; for the client records it processes on a client's instructions it is usually a Data Processor, bound by the contract the client must have with it under section 8(2).",
        "The Act places its obligations on the Data Fiduciary — the client — and reaches the processor through that contract (section 8(2)) and the safeguards the contract must carry [VERIFY: rule 6(1)(f)]; the client stays responsible whatever the contract says (section 8(1)).",
        "So a firm keeps its own file — the same jobs as any company — and, separately, can hold each client's file as the CA manager who checks the proof and the CA partner who signs it.",
      ],
      sections: [
        {
          h2: "The law, by section and rule",
          blocks: [
            { type: "ul", items: [
              { text: "Digital Personal Data Protection Act, 2023, section 2 — 'Data Fiduciary': any person who alone or with others determines the purpose and means of processing; 'Data Processor': any person who processes personal data on behalf of a Data Fiduciary.", note: "[VERIFY: the clause letters of the two definitions]" },
              "Digital Personal Data Protection Act, 2023, section 7(i) — processing for the purposes of employment, or to safeguard the employer from loss or liability, is a legitimate use: no consent is needed from the firm's own staff.",
              "Digital Personal Data Protection Act, 2023, section 8(1) — the Data Fiduciary is responsible for compliance irrespective of any agreement to the contrary.",
              "Digital Personal Data Protection Act, 2023, section 8(2) — a Data Processor may be engaged only under a valid contract.",
              { text: "Digital Personal Data Protection Rules, 2025, rule 6(1)(f) — the contract with a Data Processor must bind it to the same reasonable security safeguards.", note: `[VERIFY: ${RULES_VERIFY}]` },
              "SPDI Rules 2011, rule 7 — today, sensitive personal data may be transferred to another body corporate only if it ensures the same level of protection, and only where necessary for a lawful contract or with consent — which is what a client's engagement letter with a CA firm does.",
              "Information Technology Act, 2000, section 43A — today's negligence liability for a body corporate handling sensitive personal data, which a CA firm plainly is.",
              { text: "Chartered Accountants Act, 1949 and the ICAI Code of Ethics — the professional duty of confidentiality continues alongside the DPDP Act, and is not displaced by it.", note: "[VERIFY: the clause of the Code of Ethics or the Second Schedule to cite, if any]" },
            ] },
          ],
        },
        {
          h2: "Your own file — where you are the Data Fiduciary",
          blocks: [
            { type: "ul", items: [
              "Your staff: salary, PAN, Aadhaar, bank account, medical leave — employment is a legitimate use (section 7(i)), but the notice, the security safeguards and the erasure duty all apply.",
              "Your clients' contact people: names, phones, emails, the partner's WhatsApp — you decided to hold them, so you are the fiduciary for them.",
              "Your website's visitors and enquiries, your CCTV, your job applicants.",
              "Your Grievance Officer, your privacy policy, your leak plan — the same jobs as any company, firm or NGO.",
            ] },
          ],
        },
        {
          h2: "Your clients' files — where you are usually the Data Processor",
          blocks: [
            { type: "ul", items: [
              "The client's books, payroll, GST and TDS returns, its staff's PAN and bank details: the client decided why; you process on instruction.",
              "The engagement letter is the section 8(2) contract — it should say what you process, why, for how long, the safeguards you keep, and that you erase or return the data when the engagement ends (section 8(7)(b)).",
              "The client stays responsible (section 8(1)); your exposure is contractual and, today, under section 43A negligence.",
              "In VERIDIAN, the client's file is the client's; the CA manager checks the proof and the CA partner signs — the last two jobs in every company file.",
            ] },
          ],
        },
        {
          h2: "When you become the Data Fiduciary for client data",
          blocks: [
            { type: "ul", items: [
              "When you decide the purpose yourself — your own client-acceptance and KYC records, your own conflict checks, your own marketing to a client's staff.",
              { text: "When a statute makes you the one who must hold the record — for example, records you keep as a professional in your own name under another law.", note: "[VERIFY: whether any professional record-keeping obligation makes a CA firm a fiduciary for client-side data, and which]" },
              "When you re-use client data for anything the client did not instruct — then you are a fiduciary for that use, with no contract to shelter behind.",
            ] },
          ],
        },
        {
          h2: "In force today, or from 13 May 2027?",
          blocks: [
            { type: "ul", items: [LAWS.s.title, LAWS.d.title] },
            { type: "p", text: "Today, section 43A and the SPDI Rules apply to the firm as a body corporate engaged in professional activity; from 13 May 2027 the fiduciary/processor split above applies. [VERIFY: commencement date]" },
          ],
        },
        {
          h2: "Who usually does it",
          blocks: [
            { type: "p", text: "For the firm's own file: the partner as owner, with a named Grievance Officer. For each client's file: the manager at the CA firm that looks after this file checks the proof; the partner at the CA firm signs the file." },
          ],
        },
        {
          h2: "What proof looks like",
          blocks: [
            { type: "ul", items: [
              "The firm's own file, signed off by the partner — a dated record per job.",
              "For each client: the engagement letter with the data clauses, and the client file's sign-off chain — owner confirms, CA manager checks, CA partner signs.",
            ] },
          ],
        },
        {
          h2: "Why it matters",
          blocks: [
            { type: "p", text: "A CA firm holds more sensitive personal data than most of its clients do — PAN, bank details, financials, staff records for every client at once. Under today's law it is squarely a body corporate under section 43A; from 13 May 2027, a client cannot contract its own responsibility away (section 8(1)), so the client will look to the engagement letter, and to the firm's own file, for the safeguards it is promising the Board it has." },
          ],
        },
        {
          h2: "What done looks like",
          blocks: [
            { type: "p", text: "The firm's own file is the full company library. The client-side role is these library jobs:" },
            { type: "ul", items: jobsWhere(lib, (t) => t.product === "firm" && t.part === 7) },
            { type: "p", text: "And the jobs where an outside firm — a Data Processor — is the one who answers:" },
            { type: "ul", items: jobsWhere(lib, (t) => t.answerable_by === "processor") },
          ],
        },
      ],
    }),
  ]
}
