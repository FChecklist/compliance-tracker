// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED } from './dispatch-helpers'

export async function dispatchMarketingEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "marketing_roi_calculator": {
      const { calculateMarketingRoi } = await import("@/lib/engines/marketing-engine");
      return { roiPercent: calculateMarketingRoi(Number(inputs.revenueGenerated), Number(inputs.marketingSpend)) };
    }
    case "cac_calculator": {
      const { calculateCac } = await import("@/lib/engines/marketing-engine");
      return { cac: calculateCac(Number(inputs.totalAcquisitionSpend), Number(inputs.newCustomersAcquired)) };
    }
    case "roas_calculator": {
      const { calculateRoas } = await import("@/lib/engines/marketing-engine");
      return { roas: calculateRoas(Number(inputs.revenueFromAds), Number(inputs.adSpend)) };
    }
    case "attribution_engine": {
      const { attributeConversionLinear } = await import("@/lib/engines/marketing-engine");
      const touchpoints = inputs.touchpoints as { channel: string }[];
      if (!Array.isArray(touchpoints)) throw new Error("touchpoints must be an array");
      return attributeConversionLinear(touchpoints, Number(inputs.conversionValue));
    }
    case "campaign_scoring_engine": {
      const { calculateCampaignScore } = await import("@/lib/engines/marketing-engine");
      const weights = inputs.weights as { reach: number; engagement: number; conversion: number } | undefined;
      return { campaignScore: calculateCampaignScore({
        reachScore: Number(inputs.reachScore), engagementScore: Number(inputs.engagementScore), conversionScore: Number(inputs.conversionScore),
      }, weights) };
    }
    case "funnel_conversion_calculator": {
      const { calculateFunnelConversion } = await import("@/lib/engines/marketing-engine");
      const stageCounts = inputs.stageCounts as { stage: string; count: number }[];
      if (!Array.isArray(stageCounts)) throw new Error("stageCounts must be an array");
      return { funnel: calculateFunnelConversion(stageCounts) };
    }
  }

  return NOT_HANDLED
}
