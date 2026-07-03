import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { discoverWorkerAgent, proposeWorkerAgent, ServiceError } from "@/lib/services/worker-agent-service";

// Lists every worker agent visible to the caller across all 4 tiers: global
// (everyone), customer (their org), client (their accessible clients -- none
// yet, no clientIds are passed since there's no "current client" selection
// concept in the app yet), user (themselves). RLS is the real gate here --
// this route relies on it rather than filtering client-side.
//
// Wave 16: defaults to lifecycleStatus IN (approved, published) so a
// proposed/draft row is never silently surfaced as dispatchable -- pass
// ?lifecycleStatus=draft,proposed,approved,published,retired to see more
// (e.g. an org admin reviewing their own org's pending proposals).
export async function GET(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ agents: [] });

  try {
    const statusParam = request.nextUrl.searchParams.get("lifecycleStatus");
    const lifecycleStatus = statusParam ? statusParam.split(",").map((s) => s.trim()) : undefined;

    const agents = await discoverWorkerAgent({ orgId, userId: dbUser.id }, { lifecycleStatus });

    return NextResponse.json({
      agents: agents.map((a) => ({
        id: a.id,
        tier: a.tier,
        name: a.name,
        domain: a.domain,
        description: a.description,
        isImmutable: a.isImmutable,
        lifecycleStatus: a.lifecycleStatus,
        supervisorWorkerAgentId: a.supervisorWorkerAgentId,
        projectId: a.projectId,
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

// Wave 16: propose a new worker agent (Worker Agent Creation Hierarchy,
// constitution §4/refinement #1) -- lands as lifecycleStatus='proposed' plus
// a real approvalRequests row; nothing is dispatchable until a
// veridian_admin approves (PATCH /api/approvals/[id]) and then explicitly
// publishes it (PATCH /api/worker-agents/[id]/publish).
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 });

  try {
    const body = await request.json();
    const result = await proposeWorkerAgent({ orgId, userId: dbUser.id, dbUser }, body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Worker agent proposal error:", error);
    return NextResponse.json({ error: "Failed to propose worker agent" }, { status: 500 });
  }
}
