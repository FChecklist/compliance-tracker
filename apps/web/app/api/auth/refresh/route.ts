import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, createSessionToken } from "@/lib/auth/jwt";

export async function POST(req: NextRequest) {
  const token = req.cookies.get("session")?.value;
  if (!token) return NextResponse.json({ error: "No session" }, { status: 401 });
  const payload = await verifySessionToken(token);
  if (!payload) return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  const newToken = await createSessionToken({ sub: payload.sub!, email: payload.email as string, org_id: payload.org_id as string, role: payload.role as string, full_name: payload.full_name as string });
  const res = NextResponse.json({ success: true });
  res.cookies.set("session", newToken, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60*60*24*7 });
  return res;
}