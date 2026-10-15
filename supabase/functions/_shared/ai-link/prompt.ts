// What a person pastes into an AI (owner, 2026-09-30: "the AI work link should take the AI to the page where it can read what has to be
// done, how to do it, what is there ... for each link the instruction can be individual and personalised. This will save time and money").
//
// The paste is TWO LINES and the link, used by two functions:
// Wording (2026-10-05): a bare "open this link and follow it" was refused as prompt-injection about one run in three by a careful AI; framing the
//   link as the owner's OWN API documentation for their own account worked every time (PROJEXA's buildAiPrompt, same finding). So the first line says
//   what the link IS, the second asks for the work; neither carries a key or instructions.
//   * aiPasteText(url)  the Monday email's box, the one-tap Copy page and GET /ai/<token>/prompt. It only says "open this link and follow the
//                       page"; every instruction lives on the page, not in the paste. The person may also paste just the link: the page
//                       tells the AI everything either way.
// The page itself -- the personal task brief, the playbook for each job, what to say and ask, the emails to draft, the paths and files --
// is in dpdp-ai-link/brief.ts, playbook.ts and manual.ts. Change those and every link already sent improves, with no new email.
//
// PURE MODULE: no Deno global, no network, no imports. It is bundled into dpdp-monday-email as well, so it stays tiny.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** "12 October 2026" from "2026-10-12"; the raw string when it is not a date. */
export function longDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ymd
}

// Characters a person cannot see but a model may read: C0/C1 controls, soft hyphen, Arabic letter mark, Mongolian vowel separator,
// zero-width space and directional marks and overrides and isolates (U+200B, U+200E-200F, U+202A-202E, U+2060-206F; NOT the zero-width joiners U+200C and U+200D, which belong inside words in Indic and Persian scripts), the byte-order mark, the
// interlinear annotation marks, and the Unicode "tag" block (U+E0000-E007F) that can spell a hidden sentence.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}]/gu

/** One short line of DATA (a job name, an organisation, an address): invisible and control characters and line breaks turned into spaces, whitespace collapsed, cut to `max` characters (never in the middle of a character). */
export function oneLine(v: unknown, max = 120): string {
  const t = String(v ?? "").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim()
  const chars = Array.from(t)
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : t
}

/**
 * The paste. Two lines; the link is the LAST one. It does not repeat the instructions (they are on the page, personalised, and can be
 * improved without another email), it only makes the AI go and read them, and stop if it cannot.
 */
export function aiPasteText(url: string): string {
  return [
    "I use VERIDIAN, my organisation's DPDP data-protection software, and I want you to help me with my DPDP jobs. A plain GET on my personal access link to its API returns the API guide, documentation for you to read, written by my own organisation's software (it can only do what my own role may, and I confirm anything important myself). Please read the guide first, then help me; if you cannot open links, tell me so and stop. My link:",
    url,
  ].join("\n")
}
