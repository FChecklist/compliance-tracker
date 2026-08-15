// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED } from './dispatch-helpers'

export async function dispatchBankingEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "emi_calculator":
    case "loan_schedule_generator":
    case "amortization_engine": {
      const { calculateEmi } = await import("@/lib/engines/banking-engine");
      return calculateEmi({ principal: Number(inputs.principal), annualRatePercent: Number(inputs.annualRatePercent), tenureMonths: Number(inputs.tenureMonths) });
    }
    case "banking_interest_calculator": {
      const { calculateBankingInterest } = await import("@/lib/engines/banking-engine");
      const method = inputs.method ? String(inputs.method) : undefined;
      if (method && !["simple", "compound_daily"].includes(method)) throw new Error("method must be simple or compound_daily");
      return { interest: calculateBankingInterest(Number(inputs.principal), Number(inputs.annualRatePercent), Number(inputs.days), method as "simple" | "compound_daily" | undefined) };
    }
    case "cash_flow_projection": {
      const { projectCashFlow } = await import("@/lib/engines/banking-engine");
      const movements = inputs.movements as { date: string; amount: number }[];
      if (!Array.isArray(movements)) throw new Error("movements must be an array");
      return { projection: projectCashFlow(Number(inputs.openingBalance), movements) };
    }
    case "outstanding_cheque_engine": {
      const { findOutstandingCheques } = await import("@/lib/engines/banking-engine");
      const cheques = inputs.cheques as { id: string; issueDate: string; clearedDate?: string }[];
      if (!Array.isArray(cheques)) throw new Error("cheques must be an array");
      return { outstandingChequeIds: findOutstandingCheques(cheques, String(inputs.asOfDate ?? "")) };
    }
    case "deposit_maturity_engine": {
      const { calculateDepositMaturity } = await import("@/lib/engines/banking-engine");
      return calculateDepositMaturity(Number(inputs.principal), Number(inputs.annualRatePercent), Number(inputs.tenureMonths), inputs.compoundingFrequencyPerYear ? Number(inputs.compoundingFrequencyPerYear) : undefined);
    }
    case "credit_limit_calculator": {
      const { calculateCreditLimit } = await import("@/lib/engines/banking-engine");
      return { creditLimit: calculateCreditLimit(Number(inputs.monthlyIncome), Number(inputs.multiplier), inputs.existingMonthlyObligations ? Number(inputs.existingMonthlyObligations) : undefined) };
    }
  }

  return NOT_HANDLED
}
