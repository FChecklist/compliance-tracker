// Stub of src/lib/ai/adapter.ts for the ai-work-link-exec bundle: the model adapter and its providers. No model call on link traffic.
import { thrower } from "./unavailable"
export const assertAiProviderAllowed = thrower("the model adapter (assertAiProviderAllowed)")
export class AiProviderRefusalError extends Error {}
