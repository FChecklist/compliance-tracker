import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { getApiUsageAnalytics } from "@/lib/services/api-usage-service";

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 });

  const sinceDaysParam = request.nextUrl.searchParams.get("sinceDays");
  const sinceDays = sinceDaysParam ? Number(sinceDaysParam) : 30;

  try {
    const usage = await getApiUsageAnalytics({ orgId }, sinceDays);
    return NextResponse.json(usage);
  } catch (error) {
    console.error("API usage analytics fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch API usage analytics" }, { status: 500 });
  }
}
