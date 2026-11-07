// Wires handler.ts to Deno. Not active until Authentication > Hooks > Send Email points at this function (an explicit owner action).
import { handleSendEmail } from "./handler.ts"

const magicHtml = await Deno.readTextFile(new URL("./magic-link.html", import.meta.url))
const magicSubject = await Deno.readTextFile(new URL("./magic-link.subject.txt", import.meta.url))
Deno.serve((req) => handleSendEmail(req, { env: (k) => Deno.env.get(k) ?? "", fetch, now: () => Date.now(), magicHtml, magicSubject }))
