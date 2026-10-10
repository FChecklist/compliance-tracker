// dpdp-inbound-mail -- Cloudflare Email Worker entry point.
//
// The runtime calls email(message, env, ctx) for every mail Email Routing hands
// this Worker. All behaviour, and the reasoning behind it, is in ./handler.ts.
// Keep this module to the single default export: a Worker module's exports are
// its public surface, and only the handler belongs on it.

import { handleInbound } from "./handler.ts"
import type { Env, InboundEmailMessage } from "./types.ts"

export default {
  async email(message: InboundEmailMessage, env: Env, _ctx?: unknown): Promise<void> {
    await handleInbound(message, env)
  },
}
