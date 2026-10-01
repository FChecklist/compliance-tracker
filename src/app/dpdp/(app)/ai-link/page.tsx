import { notFound } from "next/navigation"
import { dpdpInternalAiEnabled } from "@/lib/dpdp-internal-ai"
import { AiLinkClient } from "./AiLinkClient"

// The in-app (internal) AI link is switched off -- see src/lib/dpdp-internal-ai.ts.
// The external AI work link is made from the static app (dpdp.veridian-aios.com/app).
export default function AiLinkPage() {
  if (!dpdpInternalAiEnabled()) notFound()
  return <AiLinkClient />
}
