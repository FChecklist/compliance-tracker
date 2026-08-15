// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED } from './dispatch-helpers'

export async function dispatchComplianceEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "compliance_interest_calculator": {
      const { calculateComplianceInterest } = await import("@/lib/engines/compliance-engine");
      return { interest: calculateComplianceInterest(Number(inputs.amount), Number(inputs.annualRatePercent), Number(inputs.daysLate)) };
    }
    case "filing_eligibility_engine": {
      const { checkFilingEligibility } = await import("@/lib/engines/compliance-engine");
      const preconditions = inputs.preconditions as { name: string; met: boolean }[];
      if (!Array.isArray(preconditions)) throw new Error("preconditions must be an array");
      return checkFilingEligibility(preconditions);
    }
    case "document_completeness_checker": {
      const { checkDocumentCompleteness } = await import("@/lib/engines/compliance-engine");
      const requiredDocuments = inputs.requiredDocuments as string[];
      const filedDocuments = inputs.filedDocuments as string[];
      if (!Array.isArray(requiredDocuments) || !Array.isArray(filedDocuments)) throw new Error("requiredDocuments and filedDocuments must both be arrays");
      return checkDocumentCompleteness(requiredDocuments, filedDocuments);
    }
    case "compliance_risk_scoring": {
      const { calculateComplianceRiskScore } = await import("@/lib/engines/compliance-engine");
      return { riskScore: calculateComplianceRiskScore({
        overdueItemsCount: Number(inputs.overdueItemsCount), pastPenaltiesCount: Number(inputs.pastPenaltiesCount), totalItemsCount: Number(inputs.totalItemsCount),
      }) };
    }
  }

  return NOT_HANDLED
}
