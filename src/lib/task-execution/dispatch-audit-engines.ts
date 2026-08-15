// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED, truthy } from './dispatch-helpers'

export async function dispatchAuditEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "materiality_calculator": {
      const { calculateMateriality } = await import("@/lib/engines/audit-engine");
      const baseType = String(inputs.baseType ?? "");
      if (!["revenue", "net_profit", "total_assets"].includes(baseType)) throw new Error("baseType must be revenue, net_profit, or total_assets");
      return { materiality: calculateMateriality(Number(inputs.baseAmount), baseType as "revenue" | "net_profit" | "total_assets") };
    }
    case "risk_scoring_engine": {
      const { calculateRiskScore } = await import("@/lib/engines/audit-engine");
      const factors = inputs.factors as { name: string; score: number; weight: number }[];
      if (!Array.isArray(factors)) throw new Error("factors must be an array");
      return { riskScore: calculateRiskScore(factors) };
    }
    case "duplicate_invoice_detector": {
      const { detectDuplicateInvoices } = await import("@/lib/engines/audit-engine");
      const invoices = inputs.invoices as { id: string; vendorId: string; invoiceNumber: string; amount: number }[];
      if (!Array.isArray(invoices)) throw new Error("invoices must be an array");
      return { duplicateGroups: detectDuplicateInvoices(invoices) };
    }
    case "duplicate_payment_detector": {
      const { detectDuplicatePayments } = await import("@/lib/engines/audit-engine");
      const payments = inputs.payments as { id: string; payeeId: string; amount: number; date: string }[];
      if (!Array.isArray(payments)) throw new Error("payments must be an array");
      return { duplicateGroups: detectDuplicatePayments(payments) };
    }
    case "journal_risk_analyzer": {
      const { analyzeJournalRisk } = await import("@/lib/engines/audit-engine");
      return analyzeJournalRisk({
        amount: Number(inputs.amount), postedAt: String(inputs.postedAt ?? ""),
        isManual: truthy(inputs.isManual), periodEndDate: String(inputs.periodEndDate ?? ""),
      });
    }
    case "benford_analysis_engine": {
      const { benfordAnalysis } = await import("@/lib/engines/audit-engine");
      const values = inputs.values as number[];
      if (!Array.isArray(values)) throw new Error("values must be an array of numbers");
      return benfordAnalysis(values.map(Number));
    }
    case "exception_detection_engine": {
      const { detectExceptions } = await import("@/lib/engines/audit-engine");
      const values = inputs.values as number[];
      if (!Array.isArray(values)) throw new Error("values must be an array of numbers");
      return { exceptions: detectExceptions(values.map(Number), inputs.zScoreThreshold ? Number(inputs.zScoreThreshold) : undefined) };
    }
  }

  return NOT_HANDLED
}
