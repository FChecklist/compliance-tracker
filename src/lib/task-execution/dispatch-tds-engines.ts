// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED, truthy } from './dispatch-helpers'

export async function dispatchTdsEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "tcs_calculator": {
      const { calculateTcs } = await import("@/lib/engines/in/tds-engine");
      return calculateTcs(Number(inputs.saleValue), Number(inputs.ratePercent), inputs.thresholdAmount ? Number(inputs.thresholdAmount) : undefined);
    }
    case "tds_threshold_checker": {
      const { isTdsApplicable } = await import("@/lib/engines/in/tds-engine");
      return { applicable: isTdsApplicable(String(inputs.section ?? ""), Number(inputs.cumulativePaymentAmount)) };
    }
    case "tds_section_validation_engine": {
      const { computeTdsForSection } = await import("@/lib/engines/in/tds-engine");
      return computeTdsForSection(String(inputs.section ?? ""), Number(inputs.paymentAmount), Number(inputs.cumulativePaymentAmount), inputs.hasPan === undefined ? true : truthy(inputs.hasPan));
    }
    case "tds_interest_engine": {
      const { calculateTdsInterest } = await import("@/lib/engines/in/tds-engine");
      const delayType = String(inputs.delayType ?? "");
      if (!["late_deduction", "late_deposit"].includes(delayType)) throw new Error("delayType must be late_deduction or late_deposit");
      return { interest: calculateTdsInterest(Number(inputs.tdsAmount), Number(inputs.monthsDelayed), delayType as "late_deduction" | "late_deposit") };
    }
    case "challan_matching_engine": {
      const { matchTdsChallans } = await import("@/lib/engines/in/tds-engine");
      const deductions = inputs.deductions as { id: string; period: string; amount: number }[];
      const challans = inputs.challans as { id: string; period: string; amount: number }[];
      if (!Array.isArray(deductions) || !Array.isArray(challans)) throw new Error("deductions and challans must both be arrays");
      return matchTdsChallans(deductions, challans);
    }
    case "pan_validation_engine": {
      const { isValidPanFormat } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidPanFormat(String(inputs.pan ?? "")) };
    }
  }

  return NOT_HANDLED
}
