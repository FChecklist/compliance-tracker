// AUDIT-100 item 3 (ENGINE_CAPABILITIES_2026-10-06.md, change 3 and 4): the plain-words confirm link an engine that can only print text writes for the
// person to click. It points at the static inbox page (projexa-link-pages/ai-inbox.html), whose script reads the fragment after `#` (never sent to any server)
// and only CHECKS it on load: the change is made by the person's click, after the typed code. The form is
//   <inbox>#t=<link token>&do=<function>&<name>=<value>...&n=<note>     (repeat `do=` for several changes; `pid=<project id>` inside one project)
// with spaces as %20 and & inside a value as %26. A value that is a list or an object is `<name>:j=<percent-encoded JSON>`.
// This module only WRITES that form (the examples in the guide and the workspace); the page's own parser reads it, and a test runs every example through it.

export type ConfirmLinkExample = { fn: string; params: Record<string, unknown>; pid?: string; note?: string }

const enc = (v: string): string => encodeURIComponent(v).replace(/%20/g, "%20")

/** One example link, exactly as an engine should print it. `token` is null in header mode (the page then says there is no link). */
export function confirmLinkExample(confirmHost: string, token: string | null, ex: ConfirmLinkExample): string {
  const parts: string[] = []
  if (token) parts.push(`t=${token}`)
  parts.push(`do=${enc(ex.fn)}`)
  if (ex.pid) parts.push(`pid=${enc(ex.pid)}`)
  for (const [k, v] of Object.entries(ex.params)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") parts.push(`${k}=${enc(String(v))}`)
    else parts.push(`${k}:j=${enc(JSON.stringify(v))}`)
  }
  if (ex.note) parts.push(`n=${enc(ex.note)}`)
  return `https://${confirmHost}/ai-inbox.html#${parts.join("&")}`
}

export const CREATE_PROJECT_EXAMPLE: ConfirmLinkExample = { fn: "create_project", params: { name: "Tower B & Annex" }, note: "a new project" }
export const PROGRESS_EXAMPLE: ConfirmLinkExample = { fn: "record_work_progress", params: { itemCode: "EX-01", percent: 40 }, pid: "<project id>", note: "slab poured" }

/** The recipe lines for the guide and the workspace: the rules of the link and one worked example per kind of person link. */
export function confirmLinkRecipe(confirmHost: string, token: string | null, forPerson: boolean): string[] {
  const ex = forPerson ? CREATE_PROJECT_EXAMPLE : { ...PROGRESS_EXAMPLE, pid: undefined }
  return [
    "- If you cannot send HTTP POST (most chat assistants): print ONE confirm link per change, ALONE on its own line: plain https text, no angle brackets, no code block, no other words on that line. The person clicks it, reads the change, types the code shown and confirms. Nothing changes before that.",
    "  Form: <inbox page>#t=<this link's token>&do=<function>&<name>=<value>&...&n=<short note>. Spaces are %20 and & inside a value is %26; several changes: repeat `do=`; inside one project of a person's link add `&pid=<project id>`; a list or object value is `<name>:j=<JSON, percent-encoded>`.",
    "  Example:",
    "",
    confirmLinkExample(confirmHost, token, ex),
    "",
    ...(forPerson ? ["  Inside a project (project id from the list above):", "", confirmLinkExample(confirmHost, token, { ...PROGRESS_EXAMPLE, pid: "123" }), ""] : []),
  ]
}

/**
 * AUDIT-100 item 8: how a person adds this link to Claude.ai as its ONE free custom connector (ENGINE_CAPABILITIES finding 4). The address is the link itself: it is
 * an MCP server (Streamable HTTP, no sign-in). The person does this once; after that Claude reads and proposes changes with its own tool approvals and no page.
 */
export function claudeConnectorHowTo(base: string): string[] {
  return [
    "## Add this link to Claude.ai as a connector (once, for Claude users)",
    "",
    "1. In Claude.ai open Settings, then Connectors, then Add custom connector.",
    `2. Name: PROJEXA. Address (the whole line): ${base}`,
    "3. Choose no sign-in (this address is your private link: keep it to yourself) and save. Start a new chat and switch the connector on.",
    "After that Claude can list your projects, read them and make changes with its own approval prompts; you do not open any page. If you remove the connector or revoke the link in PROJEXA, access stops.",
    "",
  ]
}
