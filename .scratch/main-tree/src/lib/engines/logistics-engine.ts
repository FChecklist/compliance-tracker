// VCEL Logistics Engine. Route optimization uses a deterministic nearest-
// neighbor heuristic + haversine distance -- genuinely fine for small stop
// counts; a real routing engine (OSRM) is the right call for production-
// scale TSP, flagged in the registry's open_source_ref rather than pretending
// this heuristic is a full solver.
import Decimal from "decimal.js"

export type GeoPoint = { id: string; lat: number; lng: number }

// Haversine distance in kilometers
function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

// 1. Route Optimization -- nearest-neighbor heuristic starting from the first point
export function optimizeRouteNearestNeighbor(points: GeoPoint[]): { orderedRoute: string[]; totalDistanceKm: number } {
  if (!points.length) return { orderedRoute: [], totalDistanceKm: 0 }
  const remaining = [...points]
  const route: GeoPoint[] = [remaining.shift()!]
  let totalDistance = 0
  while (remaining.length) {
    const current = route[route.length - 1]
    let nearestIdx = 0
    let nearestDist = Infinity
    remaining.forEach((p, i) => {
      const d = haversineKm(current, p)
      if (d < nearestDist) { nearestDist = d; nearestIdx = i }
    })
    totalDistance += nearestDist
    route.push(remaining.splice(nearestIdx, 1)[0])
  }
  return { orderedRoute: route.map((p) => p.id), totalDistanceKm: round2(new Decimal(totalDistance)) }
}

// 2. Freight Calculator -- weight-based or volumetric (whichever chargeable weight is higher, standard freight convention)
export function calculateFreightCost(actualWeightKg: number, volumeCbm: number, ratePerKg: number, volumetricDivisor = 167): { chargeableWeightKg: number; freightCost: number } {
  const volumetricWeight = volumeCbm * 1000 / (volumetricDivisor / 1000) // cbm -> kg equivalent
  const chargeableWeight = Math.max(actualWeightKg, volumetricWeight)
  return { chargeableWeightKg: round2(new Decimal(chargeableWeight)), freightCost: round2(new Decimal(chargeableWeight).mul(ratePerKg)) }
}

// 3. Delivery ETA Engine -- distance / average speed + fixed handling buffer
export function estimateDeliveryEta(distanceKm: number, avgSpeedKmh: number, handlingBufferHours = 2): { estimatedHours: number } {
  if (avgSpeedKmh <= 0) throw new Error("avgSpeedKmh must be positive")
  return { estimatedHours: round2(new Decimal(distanceKm).div(avgSpeedKmh).plus(handlingBufferHours)) }
}

// 4. Vehicle Utilization -- % of capacity used
export function calculateVehicleUtilization(loadedWeightKg: number, vehicleCapacityKg: number): number {
  if (vehicleCapacityKg <= 0) throw new Error("vehicleCapacityKg must be positive")
  return round2(new Decimal(loadedWeightKg).div(vehicleCapacityKg).mul(100))
}

// 5. Container Utilization -- % of volume used
export function calculateContainerUtilization(loadedVolumeCbm: number, containerCapacityCbm: number): number {
  if (containerCapacityCbm <= 0) throw new Error("containerCapacityCbm must be positive")
  return round2(new Decimal(loadedVolumeCbm).div(containerCapacityCbm).mul(100))
}

// 6. Shipment Cost Calculator -- sums freight + handling + insurance + customs
export function calculateShipmentCost(input: { freight: number; handling?: number; insurance?: number; customs?: number }): number {
  return round2(new Decimal(input.freight).plus(input.handling ?? 0).plus(input.insurance ?? 0).plus(input.customs ?? 0))
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }
