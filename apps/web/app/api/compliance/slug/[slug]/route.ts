import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { compliance } from "@compliancetrack/db/schema";
import { eq, and } from "drizzle-orm";

// GET /api/compliance/slug/[slug] — lookup compliance by unique URL slug
export const GET = withAuth(async (req, ctx) => {
  // Extract slug from the URL: /api/compliance/slug/[slug]
  const slug = req.nextUrl.pathname.split("/").pop();

  if (!slug) {
    return NextResponse.json({ error: "Slug is required" }, { status: 400 });
  }

  const [item] = await db
    .select()
    .from(compliance)
    .where(and(eq(compliance.unique_url_slug, slug), eq(compliance.org_id, ctx.orgId)))
    .limit(1);

  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: item });
});