import { workerAgents, tasks, taskExecutionPlan, taskChatMessages } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { eq, asc } from "drizzle-orm";
import { resolveModelConfig } from "@/lib/orchestra-model-resolver";
import { callLLMJson } from "@/lib/llm-client";

/**
 * Real task execution engine (Wave 4's biggest remaining gap): given a
 * freshly-created task, asks the LLM to break it into a short plan against
 * the org's actual worker agent roster, records that plan, posts a
 * one-message summary to the task's chat, and marks the task
 * completed/failed. This is intentionally a single-pass, synchronous
 * planner -- it does not actually invoke worker agents' underlying logic
 * (most global agents' code_reference points at existing MCP tool handlers
 * that operate on a specific compliance item, not a free-text task; wiring
 * that dispatch is future work). What's real here: the plan is grounded in
 * the org's actual available agents, not invented, and every step/message/
 * status change is a persisted row a user can see in /orchestra today.
 *
 * Failure is handled gracefully -- an LLM/config error marks the task
 * `failed` with an explanatory chat message rather than leaving it silently
 * stuck in `pending` forever or throwing back into the request that
 * created it.
 */
export async function executeTask(
  orgId: string,
  userId: string,
  taskId: string,
  title: string,
  description: string | null
): Promise<void> {
  try {
    const modelConfig = await resolveModelConfig(orgId, "task_oa");
    if (!modelConfig) {
      await markTaskOutcome(orgId, userId, taskId, "failed", "No LLM provider is configured for this organisation (task_oa layer). Set one up in Settings → AI Configuration.");
      return;
    }

    const agents = await withTenantContext({ orgId, userId }, (db) =>
      db.query.workerAgents.findMany({
        columns: { id: true, name: true, domain: true, tier: true },
        orderBy: asc(workerAgents.name),
        limit: 20,
      })
    );

    const agentList = agents.map((a) => `- ${a.name} (${a.tier}${a.domain ? `, ${a.domain}` : ""})`).join("\n");
    const systemPrompt =
      "You are the Task Orchestra Agent for a compliance management platform. Given a task and a list of " +
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

    const agentByName = new Map(agents.map((a) => [a.name.toLowerCase(), a.id]));

    await withTenantContext({ orgId, userId }, async (db) => {
      const steps = (result.steps ?? []).slice(0, 6);
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        await db.insert(taskExecutionPlan).values({
          taskId,
          stepNumber: i + 1,
          workerAgentId: step.agentName ? (agentByName.get(step.agentName.toLowerCase()) ?? null) : null,
          description: step.description,
          status: "completed",
        });
      }

      await db.insert(taskChatMessages).values({
        taskId,
        role: "assistant",
        content: result.summary || "Plan generated.",
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
