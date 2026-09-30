// What a person pastes into an AI (owner, 2026-09-30: "the AI work link should take the AI to the page where it can read what has to be
// done, how to do it, what is there ... for each link the instruction can be individual and personalised. This will save time and money").
//
// The paste is TWO LINES and the link, used by two functions:
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

/** One short line of DATA (a job name, an organisation): whitespace collapsed, no control characters, cut to `max`. */
export function oneLine(v: unknown, max = 120): string {
  // eslint-disable-next-line no-control-regex
  const t = String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/**
 * The paste. Two lines; the link is the LAST one. It does not repeat the instructions (they are on the page, personalised, and can be
 * improved without another email), it only makes the AI go and read them, and stop if it cannot.
 */
export function aiPasteText(url: string): string {
  return [
    "Please open this link and follow the instructions on that page exactly. It is my private DPDP work link: the page tells you what has to be done, how to do it and what is there. If you cannot open web links, tell me so and stop.",
    url,
  ].join("\n")
}
