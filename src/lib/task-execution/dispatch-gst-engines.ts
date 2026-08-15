// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED, truthy } from './dispatch-helpers'

export async function dispatchGstEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  const gstSplitInput = () => ({
    taxableAmount: Number(inputs.taxableAmount),
    gstRatePercent: Number(inputs.gstRatePercent),
    supplierStateCode: String(inputs.supplierStateCode ?? ''),
    buyerStateCode: String(inputs.buyerStateCode ?? ''),
  })

  switch (engineKey) {
    // cgst/sgst/igst_engine are the same underlying split -- distinct
    // registry rows/labels, one real function (matches implementation_ref).
    case "gst_split_engine":
    case "cgst_engine":
    case "sgst_engine":
    case "igst_engine": {
      const { splitGst } = await import("@/lib/engines/in/gst-engine");
      return splitGst(gstSplitInput());
    }
    case "utgst_engine": {
      const { splitGstWithUtgst } = await import("@/lib/engines/in/gst-engine");
      return splitGstWithUtgst(gstSplitInput());
    }
    case "gst_calculation_engine": {
      const { calculateGst } = await import("@/lib/engines/in/gst-engine");
      return calculateGst(gstSplitInput());
    }
    case "reverse_charge_engine": {
      const { computeReverseChargeLiability } = await import("@/lib/engines/in/gst-engine");
      return computeReverseChargeLiability({ ...gstSplitInput(), isReverseCharge: truthy(inputs.isReverseCharge) });
    }
    case "hsn_validation_engine": {
      const { isValidHsnFormat } = await import("@/lib/engines/in/gst-engine");
      return { valid: isValidHsnFormat(String(inputs.hsn ?? "")) };
    }
    case "sac_validation_engine": {
      const { isValidSacFormat } = await import("@/lib/engines/in/gst-engine");
      return { valid: isValidSacFormat(String(inputs.sac ?? "")) };
    }
    case "eway_bill_validation_engine": {
      const { isValidEwayBillNumberFormat } = await import("@/lib/engines/in/gst-engine");
      return { valid: isValidEwayBillNumberFormat(String(inputs.ebn ?? "")) };
    }
    case "gst_exclusive_engine": {
      const { gstExclusiveToInclusive } = await import("@/lib/engines/in/gst-engine");
      return gstExclusiveToInclusive(Number(inputs.taxableAmount), Number(inputs.gstRatePercent));
    }
    case "gst_inclusive_engine": {
      const { gstInclusiveToTaxable } = await import("@/lib/engines/in/gst-engine");
      return gstInclusiveToTaxable(Number(inputs.inclusiveAmount), Number(inputs.gstRatePercent));
    }
    case "gst_interest_engine": {
      const { calculateGstInterest } = await import("@/lib/engines/in/gst-engine");
      return { interest: calculateGstInterest({
        taxAmount: Number(inputs.taxAmount), daysLate: Number(inputs.daysLate),
        isExcessItcClaim: inputs.isExcessItcClaim ? truthy(inputs.isExcessItcClaim) : undefined,
      }) };
    }
    case "gst_late_fee_engine": {
      const { calculateGstLateFee } = await import("@/lib/engines/in/gst-engine");
      return calculateGstLateFee({
        daysLate: Number(inputs.daysLate),
        isNilReturn: inputs.isNilReturn ? truthy(inputs.isNilReturn) : undefined,
      });
    }
    case "itc_calculation_engine": {
      const { calculateEligibleItc } = await import("@/lib/engines/in/gst-engine");
      return calculateEligibleItc({
        totalItcAvailable: Number(inputs.totalItcAvailable), blockedCreditAmount: Number(inputs.blockedCreditAmount),
        exemptSupplyRatio: inputs.exemptSupplyRatio ? Number(inputs.exemptSupplyRatio) : undefined,
      });
    }
  }

  return NOT_HANDLED
}
