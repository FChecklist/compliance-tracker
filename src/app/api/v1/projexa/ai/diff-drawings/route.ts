// Wave 129: session-only, matching /projexa/ai/progress-summary and
// /projexa/ai/risk-detection's already-established posture -- re-exports
// the internal route directly (requireAuth(), not requireAuthOrApiKey()).
export { POST } from "@/app/api/construction/ai/diff-drawings/route"
