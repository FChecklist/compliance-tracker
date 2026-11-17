// Wires handler.ts to Deno. Not active until Authentication > Hooks > Send Email points at this function.
import { handleSendEmail } from "./handler.ts"
import { magicHtml, magicSubject } from "./templates.ts"

Deno.serve((req) => handleSendEmail(req, { env: (k) => Deno.env.get(k) ?? "", fetch, now: () => Date.now(), magicHtml, magicSubject }))
