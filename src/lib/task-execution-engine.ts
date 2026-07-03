import { workerAgents, tasks, taskExecutionPlan, taskAgentExecutions, taskChatMessages, complianceItems, departments } from "@/lib/db";
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped";
import { eq, and, asc, gte, lte, ne, inArray, sql } from "drizzle-orm";
import { resolveModelConfig } from "@/lib/orchestra-model-resolver";
import { callLLMJson } from "@/lib/llm-client";
import { buildPurposeClause, isToolAllowedForDomain, DEFAULT_DOMAIN } from "@/lib/purpose-bound-ai";

/**
 * Real task execution engine (Wave 4's biggest remaining gap): given a
 * freshly-created task, asks the LLM to break it into a short plan against
 * the org's actual worker agent roster, records that plan, and -- for the
 * handful of global read-only agents this engine knows how to actually run
 * (see DISPATCHABLE_TOOLS below) -- executes them for real against the
 * org's real data and records the output. Posts a one-message summary to
 * the task's chat and marks the task completed/failed.
 *
 * Deliberately read-only: a free-text task's LLM-generated plan is not a
 * trustworthy source of arguments for a *write* action (create/update a
 * real compliance item) without a human confirming first, so only the
 * read-only global agents are auto-dispatched. Plan steps referencing any
 * other agent (write tools, customer/client/user-tier agents) are still
 * recorded as a real row in task_execution_plan, just not auto-invoked --
 * this is disclosed in the /orchestra UI rather than silently faked.
 *
 * Failure is handled gracefully at every level -- a failed dispatch marks
 * that one step failed without failing the whole task, and an LLM/config
 * error marks the task `failed` with an explanatory chat message rather
 * than leaving it silently stuck in `pending` forever.
 */

async function dispatchTool(db: TenantDb, orgId: string, codeReference: string): Promise<unknown> {
  if (codeReference === "get_compliance_stats") {
    const now = new Date();
    const weekEnd = new Date(Date.now() + 7 * 86400000);
    const [[total], [overdue], [completed], [dueWeek]] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(complianceItems).where(eq(complianceItems.orgId, orgId)),
      db.select({ count: sql<number>`count(*)` }).from(complianceItems).where(and(eq(complianceItems.orgId, orgId), eq(complianceItems.status, "overdue"))),
      db.select({ count: sql<number>`count(*)` }).from(complianceItems).where(and(eq(complianceItems.orgId, orgId), eq(complianceItems.status, "completed"))),
      db.select({ count: sql<number>`count(*)` }).from(complianceItems).where(
        and(eq(complianceItems.orgId, orgId), gte(complianceItems.dueDate, now), lte(complianceItems.dueDate, weekEnd), ne(complianceItems.status, "completed"))
      ),
    ]);
    return { total: Number(total.count), overdue: Number(overdue.count), completed: Number(completed.count), dueThisWeek: Number(dueWeek.count) };
  }

  if (codeReference === "get_overdue_items") {
    const items = await db.query.complianceItems.findMany({
      where: and(eq(complianceItems.orgId, orgId), eq(complianceItems.status, "overdue")),
      columns: { id: true, title: true, complianceType: true, dueDate: true },
      orderBy: asc(complianceItems.dueDate),
      limit: 10,
    });
    return items.map((i) => ({ ...i, daysLate: Math.floor((Date.now() - i.dueDate.getTime()) / 86400000) }));
  }

  if (codeReference === "list_departments") {
    return db.query.departments.findMany({
      where: eq(departments.orgId, orgId),
      columns: { id: true, name: true },
    });
  }

  throw new Error(`No dispatcher implemented for ${codeReference}`);
}

export async function executeTask(
  orgId: string,
  userId: string,
  taskId: string,
  title: string,
  description: string | null,
  projectId?: string | null
): Promise<void> {
  try {
    const modelConfig = await resolveModelConfig(orgId, "task_oa");
    if (!modelConfig) {
      await markTaskOutcome(orgId, userId, taskId, "failed", "No LLM provider is configured for this organisation (task_oa layer). Set one up in Settings → AI Configuration.");
      return;
    }

    // Wave 21: agent discovery is now project-scoped, instead of
    // "everything this org has, ≤20 rows, no filter at all". This is part
    // of the concrete mechanism behind "one worker agent, no forking,
    // available across every product/project/account/user -- customized to
    // do work": an agent's optional projectId determines whether it's
    // project-specific or org-wide, the same most-specific-scope-wins
    // philosophy as module-rules-resolver.ts.
    //
    // NOT filtering by worker_agent_domain_index here, despite wiring it up
    // this wave (see proposeWorkerAgent()) -- confirmed directly against
    // live data that workerAgents.domain is a free-text CAPABILITY-PATH
    // taxonomy ("Cross-Cutting > Data Access", "India Compliance > Penalty
    // Calculation"), not the same value space as purpose-bound-ai.ts's
    // single-value DEFAULT_DOMAIN ('compliance'). Filtering discovery by
    // `domainPath = DEFAULT_DOMAIN` would have matched zero of today's real
    // agents -- a regression, not an improvement. Real domain-scoped
    // discovery needs a task-level domain concept that doesn't exist yet;
    // shipping a filter against the wrong value space to make this wave
    // look more complete would be worse than being honest that it's
    // deferred. The domain-index table itself is now genuinely populated
    // (this wave's real, additive progress) and ready for a future wave to
    // consume once tasks carry their own domain/capability-path.
    const candidates = await withTenantContext({ orgId, userId }, (db) =>
      db.query.workerAgents.findMany({
        where: inArray(workerAgents.lifecycleStatus, ["approved", "published"]),
        columns: { id: true, name: true, domain: true, tier: true, codeReference: true, projectId: true },
        orderBy: asc(workerAgents.name),
        limit: 40, // widened from 20 since project-scoped shadowing can mean 2 rows per name
      })
    );

    // Most-specific-wins: a project-scoped agent shadows an org-wide
    // (projectId IS NULL) agent of the same name, mirroring
    // module-rules-resolver.ts's resolution philosophy.
    const byName = new Map<string, (typeof candidates)[number]>();
    for (const a of candidates) {
      const key = a.name.toLowerCase();
      const existing = byName.get(key);
      if (!existing) { byName.set(key, a); continue; }
      const aIsProjectMatch = projectId && a.projectId === projectId;
      const existingIsProjectMatch = projectId && existing.projectId === projectId;
      if (aIsProjectMatch && !existingIsProjectMatch) byName.set(key, a);
      else if (!aIsProjectMatch && !a.projectId && existing.projectId && !existingIsProjectMatch) byName.set(key, a);
    }
    const agents = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20);

    const agentList = agents.map((a) => `- ${a.name} (${a.tier}${a.domain ? `, ${a.domain}` : ""})`).join("\n");
    const systemPrompt =
      "You are the Task Orchestra Agent for a compliance management platform. " +
      buildPurposeClause(DEFAULT_DOMAIN) + " " +
      "Given a task and a list of " +
      "real worker agents available to this organisation, produce a short execution plan (2-4 steps). Each " +
      "step should reference the single most relevant agent by its exact name from the list, or null if none " +
      "fit. Respond with ONLY JSON matching: " +
      '{ "summary": string, "steps": [{ "agentName": string | null, "description": string }] }';
    const userMessage = `Task: ${title}\n${description ? `Description: ${description}\n` : ""}\nAvailable agents:\n${agentList || "(none configured yet)"}`;

    const result = await callLLMJson<{
      summary: string;
      steps: { agentName: string | null; description: string }[];
    }>(modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage, {
      temperature: 0.3,
      maxTokens: 800,
    });

    const agentByName = new Map(agents.map((a) => [a.name.toLowerCase(), a]));
    const dispatchNotes: string[] = [];
    let missingCapabilityNoted = false;

    await withTenantContext({ orgId, userId }, async (db) => {
      const steps = (result.steps ?? []).slice(0, 6);
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const agent = step.agentName ? agentByName.get(step.agentName.toLowerCase()) : undefined;

        const [planRow] = await db
          .insert(taskExecutionPlan)
          .values({
            taskId,
            stepNumber: i + 1,
            workerAgentId: agent?.id ?? null,
            description: step.description,
            status: "completed",
          })
          .returning();

        // Wave 16: Worker Agent Discovery's missing half (constitution
        // refinement #4) -- the LLM named an agent that doesn't exist among
        // this org's real, approved/published roster. Never auto-create a
        // proposal from an unattended background job (that would violate
        // Scope-Limited Creation, refinement #7 -- a proposal always needs a
        // real human/layer attributed to it) -- instead surface it as an
        // actionable note a human can act on.
        if (step.agentName && !agent && !missingCapabilityNoted) {
          missingCapabilityNoted = true
          await db.insert(taskChatMessages).values({
            taskId,
            role: "system",
            content: `No approved worker agent matches "${step.agentName}" for: "${step.description}". A worker agent for this capability can be proposed in Settings -> Worker Agents.`,
          })
        }

        // Only auto-dispatch global, read-only agents this engine actually
        // knows how to run for real, AND only within this agent's declared
        // purpose/domain (Wave 17: Purpose-Bound AI enforcement -- a hard
        // allowlist check, not just the system-prompt clause above).
        // Everything else is a recorded plan step, not a faked execution.
        if (agent?.tier === "global" && agent.codeReference && isToolAllowedForDomain(agent.domain, agent.codeReference)) {
          const startedAt = new Date();
          try {
            const output = await dispatchTool(db, orgId, agent.codeReference);
            await db.insert(taskAgentExecutions).values({
              taskExecutionPlanId: planRow.id,
              workerAgentId: agent.id,
              startedAt,
              completedAt: new Date(),
              status: "completed",
              input: {},
              output: output as object,
            });
            dispatchNotes.push(`${agent.name} ran: ${JSON.stringify(output).slice(0, 300)}`);
          } catch (dispatchErr) {
            await db.insert(taskAgentExecutions).values({
              taskExecutionPlanId: planRow.id,
              workerAgentId: agent.id,
              startedAt,
              completedAt: new Date(),
              status: "failed",
              input: {},
              errorMessage: dispatchErr instanceof Error ? dispatchErr.message : "unknown error",
            });
          }
        }
      }

      const summaryWithData = dispatchNotes.length > 0 ? `${result.summary || "Plan generated."}\n\nReal data gathered:\n${dispatchNotes.join("\n")}` : result.summary || "Plan generated.";

      await db.insert(taskChatMessages).values({
        taskId,
        role: "assistant",
        content: summaryWithData,
      });

      await db.update(tasks).set({ status: "completed", updatedAt: new Date() }).where(eq(tasks.id, taskId));
    });
  } catch (err) {
    console.error("Task execution failed:", err);
    await markTaskOutcome(
      orgId,
      userId,
      taskId,
      "failed",
      `Execution failed: ${err instanceof Error ? err.message : "unknown error"}. You can retry by editing and resaving the task.`
    ).catch(() => {});
  }
}

async function markTaskOutcome(
  orgId: string,
  userId: string,
  taskId: string,
  status: "completed" | "failed",
  message: string
): Promise<void> {
  await withTenantContext({ orgId, userId }, async (db) => {
    await db.insert(taskChatMessages).values({ taskId, role: "system", content: message });
    await db.update(tasks).set({ status, updatedAt: new Date() }).where(eq(tasks.id, taskId));
  });
}
