// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED } from './dispatch-helpers'

export async function dispatchDataQualityEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "pan_validation_engine_dq": {
      const { isValidPanFormat } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidPanFormat(String(inputs.pan ?? "")) };
    }
    case "gstin_validation_engine": {
      const { isValidGstin, isValidGstinFormat } = await import("@/lib/engines/data-quality-engine");
      return { validFormat: isValidGstinFormat(String(inputs.gstin ?? "")), validChecksum: isValidGstin(String(inputs.gstin ?? "")) };
    }
    case "ifsc_validation_engine": {
      const { isValidIfscFormat } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidIfscFormat(String(inputs.ifsc ?? "")) };
    }
    case "email_validation_engine": {
      const { isValidEmail } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidEmail(String(inputs.email ?? "")) };
    }
    case "phone_validation_engine": {
      const { isValidPhoneNumber } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidPhoneNumber(String(inputs.phone ?? ""), inputs.defaultCountry ? String(inputs.defaultCountry) : undefined) };
    }
    case "bank_account_validation_engine": {
      const { isValidBankAccountFormat } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidBankAccountFormat(String(inputs.accountNumber ?? "")) };
    }
    case "address_standardization_engine": {
      const { standardizeAddress } = await import("@/lib/engines/data-quality-engine");
      return { standardizedAddress: standardizeAddress(String(inputs.address ?? "")) };
    }
  }

  return NOT_HANDLED
}
