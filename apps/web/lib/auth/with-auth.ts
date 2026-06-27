import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/jwt";
import { Role } from "@compliancetrack/types";

export type AuthContext = {
  userId: string;
  orgId: string;
  role: Role;
  email: string;
  fullName: string;
};

type Handler = (req: NextRequest, ctx: AuthContext) => Promise<NextResponse | Response>;

export function withAuth(handler: Handler, options?: { roles?: Role[] }) {
  return async (req: NextRequest): Promise<NextResponse | Response> => {
    const token = req.cookies.get("session")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized", code: "NO_TOKEN" }, { status: 401 });

    const payload = await verifySessionToken(token);
    if (!payload) return NextResponse.json({ error: "Unauthorized", code: "INVALID_TOKEN" }, { status: 401 });

    if (options?.roles && !options.roles.includes(payload.role as Role)) {
      return NextResponse.json({ error: "Forbidden", code: "INSUFFICIENT_ROLE" }, { status: 403 });
    }

    const ctx: AuthContext = {
      userId: payload.sub!,
      orgId: payload.org_id as string,
      role: payload.role as Role,
      email: payload.email as string,
      fullName: payload.full_name as string,
    };

    return handler(req, ctx);
  };
}