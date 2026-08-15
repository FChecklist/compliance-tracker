// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED } from './dispatch-helpers'

export async function dispatchLogisticsEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "route_optimization_engine": {
      const { optimizeRouteNearestNeighbor } = await import("@/lib/engines/logistics-engine");
      const points = inputs.points as { id: string; lat: number; lng: number }[];
      if (!Array.isArray(points)) throw new Error("points must be an array");
      return optimizeRouteNearestNeighbor(points);
    }
    case "freight_calculator": {
      const { calculateFreightCost } = await import("@/lib/engines/logistics-engine");
      return calculateFreightCost(Number(inputs.actualWeightKg), Number(inputs.volumeCbm), Number(inputs.ratePerKg), inputs.volumetricDivisor ? Number(inputs.volumetricDivisor) : undefined);
    }
    case "delivery_eta_engine": {
      const { estimateDeliveryEta } = await import("@/lib/engines/logistics-engine");
      return estimateDeliveryEta(Number(inputs.distanceKm), Number(inputs.avgSpeedKmh), inputs.handlingBufferHours ? Number(inputs.handlingBufferHours) : undefined);
    }
    case "vehicle_utilization_engine": {
      const { calculateVehicleUtilization } = await import("@/lib/engines/logistics-engine");
      return { utilizationPercent: calculateVehicleUtilization(Number(inputs.loadedWeightKg), Number(inputs.vehicleCapacityKg)) };
    }
    case "container_utilization_engine": {
      const { calculateContainerUtilization } = await import("@/lib/engines/logistics-engine");
      return { utilizationPercent: calculateContainerUtilization(Number(inputs.loadedVolumeCbm), Number(inputs.containerCapacityCbm)) };
    }
    case "shipment_cost_calculator": {
      const { calculateShipmentCost } = await import("@/lib/engines/logistics-engine");
      return { shipmentCost: calculateShipmentCost({
        freight: Number(inputs.freight), handling: inputs.handling ? Number(inputs.handling) : undefined,
        insurance: inputs.insurance ? Number(inputs.insurance) : undefined, customs: inputs.customs ? Number(inputs.customs) : undefined,
      }) };
    }
  }

  return NOT_HANDLED
}
