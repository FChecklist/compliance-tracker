// Wave 172 (area 16, Account/Organization lifecycle -- U-D27.B1.S1):
// org-level per-seat license assign/revoke/track + active-user-count
// enforcement against the licensed seat count. users.isActive is the real
// seat marker already in use throughout the codebase ("becomes active
// after they accept invite" -- see api/users/route.ts and
// auth-guard.ts's first-login activation) -- this module adds the missing
// enforcement layer on top of that existing, real signal rather than
// inventing a parallel one.
import { db, users, organisations } from "@/lib/db"
import { eq, and } from "drizzle-orm"

export interface LicenseStatus {
  licensedSeats: number | null
  activeSeatCount: number
  seatsAvailable: number | null
  enforcementEnabled: boolean
  isOverLimit: boolean
}

export async function getLicenseStatus(orgId: string): Promise<LicenseStatus> {
  const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
  const activeUsers = await db.query.users.findMany({
    where: and(eq(users.orgId, orgId), eq(users.isActive, true)),
    columns: { id: true },
  })
  const activeSeatCount = activeUsers.length
  const licensedSeats = org?.licensedSeats ?? null
  const enforcementEnabled = org?.seatEnforcementEnabled ?? false
  const seatsAvailable = licensedSeats === null ? null : Math.max(0, licensedSeats - activeSeatCount)
  const isOverLimit = enforcementEnabled && licensedSeats !== null && activeSeatCount >= licensedSeats
  return { licensedSeats, activeSeatCount, seatsAvailable, enforcementEnabled, isOverLimit }
}

export async function canAssignSeat(orgId: string): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const status = await getLicenseStatus(orgId)
  if (!status.enforcementEnabled || status.licensedSeats === null) return { allowed: true }
  if (status.activeSeatCount >= status.licensedSeats) {
    return {
      allowed: false,
      reason: `This organisation has used all ${status.licensedSeats} licensed seats (${status.activeSeatCount} active). An admin must revoke an existing seat or increase the licensed seat count before adding another active user.`,
    }
  }
  return { allowed: true }
}

// Called from the two real places a user becomes isActive=true: invite
// acceptance (auth-guard.ts first login) and any future direct
// admin-activation path. Fails closed on the seat check but never on a
// missing org (an org-less user isn't this function's problem).
export async function assignSeat(orgId: string, userId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const check = await canAssignSeat(orgId)
  if (!check.allowed) return { ok: false, reason: check.reason }
  await db.update(users).set({ isActive: true }).where(eq(users.id, userId))
  return { ok: true }
}

export async function revokeSeat(userId: string): Promise<void> {
  await db.update(users).set({ isActive: false }).where(eq(users.id, userId))
}

export async function setLicensedSeats(orgId: string, licensedSeats: number | null, enforcementEnabled: boolean): Promise<void> {
  await db.update(organisations).set({ licensedSeats, seatEnforcementEnabled: enforcementEnabled }).where(eq(organisations.id, orgId))
}
