// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED } from './dispatch-helpers'

export async function dispatchCrmEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "customer_lifetime_value_calculator": {
      const { calculateCustomerLifetimeValue } = await import("@/lib/engines/crm-engine");
      return { clv: calculateCustomerLifetimeValue(Number(inputs.avgOrderValue), Number(inputs.purchaseFrequencyPerYear), Number(inputs.customerLifespanYears)) };
    }
    case "churn_probability_calculator": {
      const { calculateChurnProbability } = await import("@/lib/engines/crm-engine");
      return { churnProbability: calculateChurnProbability(Number(inputs.daysSinceLastActivity), Number(inputs.engagementDeclinePercent)) };
    }
    case "rfm_scoring_engine": {
      const { calculateRfmScore } = await import("@/lib/engines/crm-engine");
      const customers = inputs.customers as { id: string; recencyDays: number; frequency: number; monetary: number }[];
      if (!Array.isArray(customers)) throw new Error("customers must be an array");
      return calculateRfmScore(customers);
    }
    case "opportunity_score_calculator": {
      const { calculateOpportunityScore } = await import("@/lib/engines/crm-engine");
      return { opportunityScore: calculateOpportunityScore({
        budget: Number(inputs.budget), authority: Number(inputs.authority), need: Number(inputs.need), timeline: Number(inputs.timeline),
      }) };
    }
    case "customer_health_score": {
      const { calculateCustomerHealthScore } = await import("@/lib/engines/crm-engine");
      const weights = inputs.weights as { usage: number; support: number; payment: number } | undefined;
      return { healthScore: calculateCustomerHealthScore({
        usageScore: Number(inputs.usageScore), supportScore: Number(inputs.supportScore), paymentScore: Number(inputs.paymentScore),
      }, weights) };
    }
  }

  return NOT_HANDLED
}
