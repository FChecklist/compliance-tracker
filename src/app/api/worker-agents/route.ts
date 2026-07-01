import { workerAgents } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

// Lists every worker agent visible to the caller across all 4 tiers: global
// (everyone), customer (their org), client (their accessible clients -- none
// yet, no clientIds are passed since there's no "current client" selection
// concept in the app yet), user (themselves). RLS is the real gate here --
// this route relies on it rather than filtering client-side.
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ agents: [] });

  try {
    const agents = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      db.query.workerAgents.findMany({
        orderBy: asc(workerAgents.name),
      })
    );

    return NextResponse.json({
      agents: agents.map((a) => ({
        id: a.id,
        tier: a.tier,
        name: a.name,
        domain: a.domain,
        description: a.description,
        isImmutable: a.isImmutable,
        version: a.version,
        usageCount: a.usageCount,
        accuracyScore: a.accuracyScore,
      })),
    });
  } catch (error) {
    console.error("Worker agents list error:", error);
    return NextResponse.json({ error: "Failed to fetch worker agents" }, { status: 500 });
  }
}
