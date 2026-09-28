import { notFound } from "next/navigation"
import { dpdpInternalAiEnabled } from "@/lib/dpdp-internal-ai"
import { AiWorkClient } from "./AiWorkClient"

// The in-app (internal) AI proposals queue is switched off -- see src/lib/dpdp-internal-ai.ts.
export default function AiWorkPage() {
  if (!dpdpInternalAiEnabled()) notFound()
  return <AiWorkClient />
}
