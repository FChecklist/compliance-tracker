import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";

// GET /api/integrations/whatsapp — stub
// TODO: Integrate Meta WhatsApp Business API for deadline notifications
export const GET = withAuth(async () => {
  return NextResponse.json({
    success: true,
    data: { status: "not_configured", message: "WhatsApp Business API integration pending" },
  });
}, { roles: ["admin", "super_admin", "account_admin"] });