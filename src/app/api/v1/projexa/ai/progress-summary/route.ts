// Wave 124: re-exported under /projexa for namespace coherence. This
// endpoint requires a real user session (requireAuth via the internal
// route), not an API key, matching the AI-feature posture already
// established -- resolveModelConfig/recordOrchestraExecution attribute
// usage to a real user.
export { GET } from "@/app/api/construction/ai/progress-summary/route"
