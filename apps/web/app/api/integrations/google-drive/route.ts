import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";

// GET /api/integrations/google-drive — stub
// TODO: Integrate Google Drive OAuth2 for document storage/sync
export const GET = withAuth(async () => {
  return NextResponse.json({
    success: true,
    data: { status: "not_configured", message: "Google Drive OAuth integration pending" },
  });
}, { roles: ["account_admin"] });