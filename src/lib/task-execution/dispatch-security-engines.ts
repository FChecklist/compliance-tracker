// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED } from './dispatch-helpers'

export async function dispatchSecurityEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "hash_generation_engine": {
      const { generateHash, generateHmac } = await import("@/lib/engines/security-engine");
      const algorithm = inputs.algorithm ? String(inputs.algorithm) : undefined;
      if (algorithm && !["sha256", "sha512"].includes(algorithm)) throw new Error("algorithm must be sha256 or sha512");
      if (inputs.secret) return { hmac: generateHmac(String(inputs.input ?? ""), String(inputs.secret), algorithm as "sha256" | "sha512" | undefined) };
      return { hash: generateHash(String(inputs.input ?? ""), algorithm as "sha256" | "sha512" | undefined) };
    }
    case "digital_signature_engine": {
      const { signData, verifySignature } = await import("@/lib/engines/security-engine");
      if (inputs.mode === "verify") {
        return { valid: verifySignature(String(inputs.data ?? ""), String(inputs.signatureHex ?? ""), String(inputs.publicKeyPem ?? "")) };
      }
      return { signatureHex: signData(String(inputs.data ?? ""), String(inputs.privateKeyPem ?? "")) };
    }
    case "access_control_evaluation_engine": {
      const { isToolAllowedForDomain } = await import("@/lib/purpose-bound-ai");
      return { allowed: isToolAllowedForDomain(inputs.domain ? String(inputs.domain) : null, inputs.codeReference ? String(inputs.codeReference) : null) };
    }
  }

  return NOT_HANDLED
}
