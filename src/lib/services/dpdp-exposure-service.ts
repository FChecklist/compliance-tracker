// WO-DPDP-001 4.8 -- the "work out what you hold" calculator (the S/anyone
// layer's first screen) and the band it maps to. Deliberately does NOT set
// a price: dpdp.band.annual_paise is reserved to the Owner (work order #11,
// "leave the table empty and seeded only with band boundaries") and stays
// NULL from drizzle/0415's own seed. This file only computes the COUNT and
// looks up which boundary it falls in -- never a rupee figure.
import { eq } from "drizzle-orm"
import { dpdpExposureEstimate } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"

export type ExposureInput = {
  employees: number; customers: number; applicants: number; cctvMonthly: number; other: number
  vendorCount: number; vendorStaffEach: number; advisorCount: number
}

export function computeExposureTotal(input: ExposureInput): number {
  return Math.max(0, Math.round(
    input.employees + input.customers + input.applicants + input.cctvMonthly + input.other +
    input.vendorCount * input.vendorStaffEach + input.advisorCount
  ))
}

export async function bandForTotal(total: number) {
  const bands = await import("@/lib/db").then((m) => m.db.query.dpdpBand.findMany())
  return bands.find((b) => total >= b.floor && (b.ceiling === null || total <= b.ceiling)) ?? null
}

export async function saveExposureEstimate(orgId: string, input: ExposureInput) {
  const total = computeExposureTotal(input)
  const band = await bandForTotal(total)
  return withDpdpContext({ orgId }, async (tx) => {
    const existing = await tx.query.dpdpExposureEstimate.findFirst({ where: eq(dpdpExposureEstimate.orgId, orgId) })
    const values = { ...input, computedTotal: total, band: band?.key ?? null }
    if (existing) {
      const [updated] = await tx.update(dpdpExposureEstimate).set(values).where(eq(dpdpExposureEstimate.orgId, orgId)).returning()
      return updated
    }
    const [created] = await tx.insert(dpdpExposureEstimate).values({ orgId, ...values }).returning()
    return created
  })
}

export async function getExposureEstimate(orgId: string) {
  return withDpdpContext({ orgId }, (tx) => tx.query.dpdpExposureEstimate.findFirst({ where: eq(dpdpExposureEstimate.orgId, orgId) }))
}

export async function listBands() {
  const { db } = await import("@/lib/db")
  return db.query.dpdpBand.findMany({ orderBy: (t, { asc }) => [asc(t.floor)] })
}
