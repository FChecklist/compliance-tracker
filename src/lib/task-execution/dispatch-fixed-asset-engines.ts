// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED, truthy } from './dispatch-helpers'

export async function dispatchFixedAssetEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "straight_line_depreciation_engine": {
      const { straightLineDepreciation } = await import("@/lib/engines/fixed-asset-engine");
      return { schedule: straightLineDepreciation({ cost: Number(inputs.cost), salvageValue: Number(inputs.salvageValue), usefulLifeYears: Number(inputs.usefulLifeYears) }) };
    }
    case "wdv_depreciation_engine": {
      const { writtenDownValueDepreciation } = await import("@/lib/engines/fixed-asset-engine");
      return { schedule: writtenDownValueDepreciation({
        cost: Number(inputs.cost), salvageValue: Number(inputs.salvageValue), usefulLifeYears: Number(inputs.usefulLifeYears),
        rate: inputs.rate ? Number(inputs.rate) : undefined,
      }) };
    }
    case "useful_life_calculator": {
      const { calculateRemainingUsefulLife } = await import("@/lib/engines/fixed-asset-engine");
      return { remainingUsefulLifeYears: calculateRemainingUsefulLife(Number(inputs.originalUsefulLifeYears), Number(inputs.ageInYears)) };
    }
    case "asset_transfer_engine": {
      const { transferAsset } = await import("@/lib/engines/fixed-asset-engine");
      return transferAsset(Number(inputs.netBookValue), String(inputs.fromLocation ?? ""), String(inputs.toLocation ?? ""));
    }
    case "asset_disposal_engine": {
      const { calculateDisposalGainLoss } = await import("@/lib/engines/fixed-asset-engine");
      return calculateDisposalGainLoss(Number(inputs.netBookValue), Number(inputs.saleProceeds));
    }
    case "capitalization_engine": {
      const { shouldCapitalize } = await import("@/lib/engines/fixed-asset-engine");
      return { shouldCapitalize: shouldCapitalize(Number(inputs.expenseAmount), Number(inputs.capitalizationThreshold), truthy(inputs.extendsUsefulLife)) };
    }
    case "revaluation_engine": {
      const { revalueAsset } = await import("@/lib/engines/fixed-asset-engine");
      return revalueAsset(Number(inputs.currentNetBookValue), Number(inputs.fairValue));
    }
    case "impairment_engine": {
      const { calculateImpairmentLoss } = await import("@/lib/engines/fixed-asset-engine");
      return calculateImpairmentLoss(Number(inputs.carryingValue), Number(inputs.recoverableAmount));
    }
  }

  return NOT_HANDLED
}
