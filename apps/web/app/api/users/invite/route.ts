import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { users } from "@compliancetrack/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { logAuditEvent } from "@/lib/auth/audit-logger";

const schema = z.object({ email: z.string().email(), full_name: z.string().min(2), role: z.enum(["client_department_admin","editor","viewer"]) });

export const POST = withAuth(async (req, ctx) => {
  const data = schema.parse(await req.json());
  const [existing] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, data.email), eq(users.org_id, ctx.orgId))).limit(1);
  if (existing) return NextResponse.json({ error: "User already in org", code: "DUPLICATE_USER" }, { status: 409 });

  const id = uuidv4();
  await db.insert(users).values({ id, org_id: ctx.orgId, email: data.email, full_name: data.full_name, role: data.role, is_active: false });
  await logAuditEvent({ action: "user.invited", userId: ctx.userId, orgId: ctx.orgId, req, meta: { invited_email: data.email } });
  return NextResponse.json({ success: true, id, message: "Invite sent" }, { status: 201 });
}, { roles: ["account_admin", "client_department_admin"] });