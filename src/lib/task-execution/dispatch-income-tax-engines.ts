// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED, truthy } from './dispatch-helpers'

export async function dispatchIncomeTaxEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "income_tax_calculator": {
      const { calculateIncomeTax } = await import("@/lib/engines/in/income-tax-engine");
      return calculateIncomeTax(Number(inputs.taxableIncome));
    }
    case "advance_tax_calculator": {
      const { calculateAdvanceTaxInstallment } = await import("@/lib/engines/in/income-tax-engine");
      const quarter = String(inputs.quarter ?? "");
      if (!["q1", "q2", "q3", "q4"].includes(quarter)) throw new Error("quarter must be one of q1, q2, q3, q4");
      return { installmentDue: calculateAdvanceTaxInstallment(Number(inputs.estimatedAnnualTax), quarter as "q1" | "q2" | "q3" | "q4", Number(inputs.alreadyPaid)) };
    }
    case "self_assessment_tax_calculator": {
      const { calculateSelfAssessmentTax } = await import("@/lib/engines/in/income-tax-engine");
      return { balanceDue: calculateSelfAssessmentTax(Number(inputs.totalTaxLiability), Number(inputs.tdsDeducted), Number(inputs.advanceTaxPaid), inputs.interestDue ? Number(inputs.interestDue) : undefined) };
    }
    case "income_tax_interest_calculator": {
      const { calculateIncomeTaxInterest } = await import("@/lib/engines/in/income-tax-engine");
      const section = inputs.section ? String(inputs.section) : "234B";
      if (!["234A", "234B", "234C"].includes(section)) throw new Error("section must be one of 234A, 234B, 234C");
      return { interest: calculateIncomeTaxInterest(Number(inputs.unpaidAmount), Number(inputs.monthsDelayed), section as "234A" | "234B" | "234C") };
    }
    case "income_tax_penalty_calculator": {
      const { calculateLateFilingPenalty } = await import("@/lib/engines/in/income-tax-engine");
      return { penalty: calculateLateFilingPenalty(Number(inputs.totalIncome), truthy(inputs.filedAfterDueDate)) };
    }
    case "capital_gains_calculator": {
      const { calculateCapitalGains } = await import("@/lib/engines/in/income-tax-engine");
      const assetType = inputs.assetType ? String(inputs.assetType) : undefined;
      if (assetType && !["equity", "other"].includes(assetType)) throw new Error("assetType must be equity or other");
      return calculateCapitalGains({
        saleValue: Number(inputs.saleValue), costOfAcquisition: Number(inputs.costOfAcquisition),
        costOfImprovement: inputs.costOfImprovement ? Number(inputs.costOfImprovement) : undefined,
        expensesOnTransfer: inputs.expensesOnTransfer ? Number(inputs.expensesOnTransfer) : undefined,
        isLongTerm: truthy(inputs.isLongTerm), assetType: assetType as "equity" | "other" | undefined,
      });
    }
    case "indexation_calculator": {
      const { calculateIndexedCost } = await import("@/lib/engines/in/income-tax-engine");
      return { indexedCost: calculateIndexedCost(Number(inputs.originalCost), Number(inputs.costInflationIndexAtPurchase), Number(inputs.costInflationIndexAtSale)) };
    }
    case "mat_calculator": {
      const { calculateMat } = await import("@/lib/engines/in/income-tax-engine");
      return calculateMat(Number(inputs.bookProfit), Number(inputs.normalTaxLiability));
    }
    case "amt_calculator": {
      const { calculateAmt } = await import("@/lib/engines/in/income-tax-engine");
      return calculateAmt(Number(inputs.adjustedTotalIncome), Number(inputs.normalTaxLiability));
    }
  }

  return NOT_HANDLED
}
