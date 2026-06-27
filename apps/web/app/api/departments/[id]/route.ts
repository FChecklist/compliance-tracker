import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { departments } from "@compliancetrack/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const updateSchema = z.object({ name: z.string().min(1).optional(), description: z.string().optional() });

export const PUT = withAuth(async (req, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-2)!;
  const data = updateSchema.parse(await req.json());
  await db.update(departments).set({ ...data, updated_at: new Date() }).where(and(eq(departments.id, id), eq(departments.org_id, ctx.orgId)));
  return NextResponse.json({ success: true });
}, { roles: ["account_admin", "client_department_admin"] });

export const DELETE = withAuth(async (req, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-2)!;
  await db.delete(departments).where(and(eq(departments.id, id), eq(departments.org_id, ctx.orgId)));
  return NextResponse.json({ success: true });
}, { roles: ["account_admin"] });