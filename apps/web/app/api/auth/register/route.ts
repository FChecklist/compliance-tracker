import { NextRequest, NextResponse } from "next/server";
import { db } from "@compliancetrack/db";
import { organisations, users } from "@compliancetrack/db";
import { createSessionToken } from "@/lib/auth/jwt";
import { logAuditEvent } from "@/lib/auth/audit-logger";
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({
  org_name: z.string().min(2).max(100),
  email: z.string().email(),
  passcode: z.string().min(4).max(8),
  full_name: z.string().min(2),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = schema.parse(body);

    const passcodeHash = await hash(data.passcode, 12);

    const [org] = await db.insert(organisations).values({
      name: data.org_name,
      slug: data.org_name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
      owner_id: "", // will be updated below
    }).returning();

    const [user] = await db.insert(users).values({
      org_id: org.id,
      email: data.email,
      full_name: data.full_name,
      passcode_hash: passcodeHash,
      role: "account_admin",
      is_active: true,
    }).returning();

    // Set the org owner to the newly created user
    await db.update(organisations).set({ owner_id: user.id }).where(eq(organisations.id, org.id));

    const token = await createSessionToken({
      sub: user.id,
      email: data.email,
      org_id: org.id,
      role: "account_admin",
      full_name: data.full_name,
    });

    await logAuditEvent({ action: "user.register", userId: user.id, orgId: org.id, req });

    const res = NextResponse.json({ success: true, org_id: org.id, user_id: user.id }, { status: 201 });
    res.cookies.set("session", token, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 7 });
    return res;
  } catch (e: any) {
    if (e.name === "ZodError") return NextResponse.json({ error: "Validation failed", details: e.errors }, { status: 400 });
    if (e.code === "23505") return NextResponse.json({ error: "Email already registered", code: "DUPLICATE_EMAIL" }, { status: 409 });
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}