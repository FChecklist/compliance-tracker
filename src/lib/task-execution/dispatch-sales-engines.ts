// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED } from './dispatch-helpers'

export async function dispatchSalesEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "margin_calculator": {
      const { calculateMargin } = await import("@/lib/engines/sales-engine");
      return { marginPercent: calculateMargin(Number(inputs.sellingPrice), Number(inputs.cost)) };
    }
    case "markup_calculator": {
      const { calculateMarkup, priceFromMarkup } = await import("@/lib/engines/sales-engine");
      if (inputs.mode === "price_from_markup") {
        return { price: priceFromMarkup(Number(inputs.cost), Number(inputs.markupPercent)) };
      }
      return { markupPercent: calculateMarkup(Number(inputs.sellingPrice), Number(inputs.cost)) };
    }
    case "sales_incentive_calculator": {
      const { calculateSalesIncentive } = await import("@/lib/engines/sales-engine");
      const slabs = inputs.slabs as { minAchievementPercent: number; incentivePercentOfSales: number }[];
      if (!Array.isArray(slabs)) throw new Error("slabs must be an array");
      return { incentiveAmount: calculateSalesIncentive(Number(inputs.achievedSales), Number(inputs.targetSales), slabs) };
    }
    case "pricing_engine": {
      const { priceForTargetMargin } = await import("@/lib/engines/sales-engine");
      return { price: priceForTargetMargin(Number(inputs.cost), Number(inputs.targetMarginPercent)) };
    }
    case "quote_optimizer": {
      const { optimizeQuoteDiscount } = await import("@/lib/engines/sales-engine");
      return { maxDiscountPercent: optimizeQuoteDiscount(Number(inputs.cost), Number(inputs.listPrice), Number(inputs.minAcceptableMarginPercent)) };
    }
    case "sales_forecast_engine": {
      const { forecastSales } = await import("@/lib/engines/sales-engine");
      const historicalValues = inputs.historicalValues as number[];
      if (!Array.isArray(historicalValues)) throw new Error("historicalValues must be an array");
      return { forecast: forecastSales(historicalValues.map(Number), Number(inputs.periodsAhead)) };
    }
    case "pipeline_probability_engine": {
      const { calculatePipelineExpectedValue } = await import("@/lib/engines/sales-engine");
      const deals = inputs.deals as { stage: string; amount: number }[];
      if (!Array.isArray(deals)) throw new Error("deals must be an array");
      return { expectedValue: calculatePipelineExpectedValue(deals) };
    }
  }

  return NOT_HANDLED
}
