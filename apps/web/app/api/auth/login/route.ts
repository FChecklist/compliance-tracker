import { NextRequest, NextResponse } from "next/server";
import { db } from "@compliancetrack/db";
import { users } from "@compliancetrack/db";
import { createSessionToken } from "@/lib/auth/jwt";
import { logAuditEvent } from "@/lib/auth/audit-logger";
import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({ email: z.string().email(), passcode: z.string().min(4).max(8) });

export async function POST(req: NextRequest) {
  try {
    const { email, passcode } = schema.parse(await req.json());
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !user.is_active) return NextResponse.json({ error: "Invalid credentials", code: "INVALID_CREDENTIALS" }, { status: 401 });

    if (!user.passcode_hash) return NextResponse.json({ error: "Passcode not set", code: "NO_PASSCODE" }, { status: 401 });

    const valid = await compare(passcode, user.passcode_hash);
    if (!valid) return NextResponse.json({ error: "Invalid credentials", code: "INVALID_CREDENTIALS" }, { status: 401 });

    const token = await createSessionToken({ sub: user.id, email: user.email, org_id: user.org_id, role: user.role, full_name: user.full_name });
    await logAuditEvent({ action: "user.login", userId: user.id, orgId: user.org_id, req });

    const res = NextResponse.json({ success: true, user: { id: user.id, email: user.email, role: user.role, full_name: user.full_name } });
    res.cookies.set("session", token, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 7 });
    return res;
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "ZodError") return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}