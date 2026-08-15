// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED } from './dispatch-helpers'

export async function dispatchProcurementEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "purchase_cost_calculator": {
      const { calculatePurchaseCost } = await import("@/lib/engines/procurement-engine");
      return { purchaseCost: calculatePurchaseCost(Number(inputs.unitPrice), Number(inputs.quantity), inputs.otherCharges ? Number(inputs.otherCharges) : undefined) };
    }
    case "vendor_comparison_engine": {
      const { rankVendors } = await import("@/lib/engines/procurement-engine");
      const vendors = inputs.vendors as { vendorId: string; priceScore: number; qualityScore: number; deliveryScore: number }[];
      if (!Array.isArray(vendors)) throw new Error("vendors must be an array");
      const weights = inputs.weights as { price: number; quality: number; delivery: number } | undefined;
      return rankVendors(vendors, weights);
    }
    case "bid_evaluation_engine": {
      const { evaluateBids } = await import("@/lib/engines/procurement-engine");
      const bids = inputs.bids as { bidderId: string; price: number; technicalScore: number }[];
      if (!Array.isArray(bids)) throw new Error("bids must be an array");
      return evaluateBids(bids, Number(inputs.minTechnicalScore));
    }
    case "purchase_price_variance_engine": {
      const { calculatePurchasePriceVariance } = await import("@/lib/engines/procurement-engine");
      return calculatePurchasePriceVariance(Number(inputs.standardPrice), Number(inputs.actualPrice), Number(inputs.quantity));
    }
    case "landed_cost_engine": {
      const { calculateLandedCost } = await import("@/lib/engines/procurement-engine");
      return calculateLandedCost({
        purchaseCost: Number(inputs.purchaseCost), freight: Number(inputs.freight),
        insurance: inputs.insurance ? Number(inputs.insurance) : undefined,
        customsDuty: inputs.customsDuty ? Number(inputs.customsDuty) : undefined,
        otherCharges: inputs.otherCharges ? Number(inputs.otherCharges) : undefined,
        quantity: Number(inputs.quantity),
      });
    }
    case "freight_allocation_engine": {
      const { allocateFreight } = await import("@/lib/engines/procurement-engine");
      const lineItems = inputs.lineItems as { id: string; weight?: number; value?: number }[];
      if (!Array.isArray(lineItems)) throw new Error("lineItems must be an array");
      const basis = inputs.basis ? String(inputs.basis) : undefined;
      if (basis && !["weight", "value"].includes(basis)) throw new Error("basis must be weight or value");
      return allocateFreight(lineItems, Number(inputs.totalFreightCost), basis as "weight" | "value" | undefined);
    }
    case "moq_optimizer": {
      const { optimizeForMoq } = await import("@/lib/engines/procurement-engine");
      return { optimizedQuantity: optimizeForMoq(Number(inputs.requiredQuantity), Number(inputs.moq), inputs.orderMultiple ? Number(inputs.orderMultiple) : undefined) };
    }
  }

  return NOT_HANDLED
}
