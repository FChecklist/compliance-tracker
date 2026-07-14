import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { complianceItems, notices } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { eq } from "drizzle-orm";
import { callLLMJsonCached } from "@/lib/llm-response-cache";
import { resolveModelConfig } from "@/lib/orchestra-model-resolver";
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver";
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger";
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine";
import { DEFAULT_DOMAIN } from "@/lib/purpose-bound-ai";

type EventType =
  | "document.uploaded"
  | "item.overdue"
  | "notice.received"
  | "deadline.approaching";

const VALID_EVENTS: EventType[] = [
  "document.uploaded",
  "item.overdue",
  "notice.received",
  "deadline.approaching",
];

interface OrchestratedAction {
  type: string;
  label: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  payload?: Record<string, unknown>;
}

interface OrchestratorResponse {
  eventType: EventType;
  entityId: string;
  timestamp: string;
  context: string;
  actions: OrchestratedAction[];
}

// Wave 23: event-specific system prompts now come from the Prompt
// Operating System (prompt_templates/prompt_versions) instead of being
// hardcoded here -- each seeded 'production' version is a byte-identical
// copy of what this function used to return inline.
const EVENT_PROMPT_TEMPLATE_KEYS: Record<EventType, string> = {
  "document.uploaded": "orchestrate.document_uploaded",
  "item.overdue": "orchestrate.item_overdue",
  "notice.received": "orchestrate.notice_received",
  "deadline.approaching": "orchestrate.deadline_approaching",
};

async function getSystemPrompt(eventType: EventType): Promise<string> {
  return resolvePromptTemplate(EVENT_PROMPT_TEMPLATE_KEYS[eventType]);
}

function getUserMessage(
  eventType: EventType,
  entityId: string,
  payload: Record<string, unknown> | undefined
): string {
  // Build context from the entity data
  let context = `Event: ${eventType}\nEntity ID: ${entityId}\n`;

  if (payload) {
    context += `Additional Data:\n${JSON.stringify(payload, null, 2)}\n`;
  }

  return context;
}

export async function POST(request: NextRequest) {
  const { user, dbUser, orgId, response: authError } = await requireAuth();
  if (!user) return authError!;
  if (!orgId) {
    return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });
  }

  const startedAt = Date.now();
  let parsedEventType: string | undefined;
  let parsedEntityId: string | undefined;

  try {
    const body = await request.json();
    const { eventType, entityId, payload } = body as {
      eventType: string;
      entityId: string;
      payload?: Record<string, unknown>;
    };
    parsedEventType = eventType;
    parsedEntityId = entityId;

    if (!eventType || !VALID_EVENTS.includes(eventType as EventType)) {
      return NextResponse.json(
        {
          error: `Invalid eventType. Must be one of: ${VALID_EVENTS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    if (!entityId || typeof entityId !== "string") {
      return NextResponse.json(
        { error: "entityId is required" },
        { status: 400 }
      );
    }

    const typedEvent = eventType as EventType;

    // Enrich context by fetching entity data from DB
    let enrichedPayload = { ...payload };

    try {
      if (
        typedEvent === "item.overdue" ||
        typedEvent === "deadline.approaching"
      ) {
        // RLS-scoped -- previously this had no org check at all, so an
        // authenticated user from any org could pass another org's
        // entityId and get AI suggestions built from that org's data.
        const item = await withTenantContext({ orgId }, (db) =>
          db.query.complianceItems.findFirst({
            where: eq(complianceItems.id, entityId),
            with: {
              department: { columns: { name: true } },
              assignedTo: { columns: { name: true, email: true } },
            },
          })
        );
        if (item) {
          const daysOverdue = item.dueDate
            ? Math.floor(
                (Date.now() - new Date(item.dueDate).getTime()) /
                  (1000 * 60 * 60 * 24)
              )
            : 0;
          enrichedPayload = {
            ...enrichedPayload,
            title: item.title,
            complianceType: item.complianceType,
            status: item.status,
            priority: item.priority,
            dueDate: item.dueDate?.toISOString(),
            department: item.department?.name,
            assignedTo: item.assignedTo?.name,
            daysOverdue,
          };
        }
      }

      if (typedEvent === "notice.received") {
        const notice = await withTenantContext({ orgId }, (db) =>
          db.query.notices.findFirst({
            where: eq(notices.id, entityId),
            with: {
              department: { columns: { name: true } },
              assignedTo: { columns: { name: true, email: true } },
            },
          })
        );
        if (notice) {
          const daysUntilDeadline = notice.replyDeadline
            ? Math.floor(
                (new Date(notice.replyDeadline).getTime() - Date.now()) /
                  (1000 * 60 * 60 * 24)
              )
            : null;
          enrichedPayload = {
            ...enrichedPayload,
            noticeNumber: notice.noticeNumber,
            authority: notice.authority,
            demandAmount: notice.demandAmount,
            status: notice.status,
            dateReceived: notice.dateReceived?.toISOString(),
            replyDeadline: notice.replyDeadline?.toISOString(),
            daysUntilDeadline,
            department: notice.department?.name,
            description: notice.description,
          };
        }
      }
    } catch (err) {
      console.warn("Could not enrich orchestrator context:", err);
    }

    // Resolve which provider/model this org uses for the Task Orchestra
    // Agent layer -- their own BYO customer_model_config if they've set one,
    // else the platform default (Groq). See lib/orchestra-model-resolver.ts.
    const systemPrompt = await getSystemPrompt(typedEvent);
    const userMessage = getUserMessage(typedEvent, entityId, enrichedPayload);

    // Gap closure, 2026-07-09 (AUDIT_2026-07-09.md, Agent Framework section):
    // enrichedPayload can carry free text a human entered elsewhere (e.g. a
    // notice's description) -- checked before the LLM call for the same
    // reason every other real call site is, even though this endpoint isn't
    // a live chat surface.
    const policyDecision = enforcePolicy(
      { orgId, userId: dbUser?.id, domain: DEFAULT_DOMAIN, layerKey: "task_oa", eventType: typedEvent },
      userMessage
    );
    if (!policyDecision.allowed) {
      const defaultActions = getDefaultActions(typedEvent, entityId, enrichedPayload);
      return NextResponse.json({
        eventType: typedEvent,
        entityId,
        timestamp: new Date().toISOString(),
        context: refusalMessageFor(policyDecision),
        actions: defaultActions,
      });
    }

    const modelConfig = await resolveModelConfig(orgId, "task_oa");
    if (!modelConfig) {
      // Return sensible defaults without AI
      const defaultActions = getDefaultActions(typedEvent, entityId, enrichedPayload);
      recordOrchestraExecution({
        orgId, layerKey: "task_oa", eventType: typedEvent, input: { entityId, payload: enrichedPayload },
        status: "completed", durationMs: Date.now() - startedAt, output: { actions: defaultActions },
      });
      return NextResponse.json({
        eventType: typedEvent,
        entityId,
        timestamp: new Date().toISOString(),
        context: `No LLM provider configured. Returning default actions for ${typedEvent}.`,
        actions: defaultActions,
      });
    }

    // Gap closure, 2026-07-14 (Item B, llm-response-cache wiring audit):
    // this event-driven endpoint fires from real system events (an item
    // going overdue, a notice arriving) whose userMessage embeds
    // Math.floor()-granularity fields (daysOverdue/daysUntilDeadline) that
    // only change once per calendar day -- so a duplicate webhook delivery,
    // a UI retry, or the user reopening the same item's AI panel more than
    // once the same day genuinely produces the exact same (org, provider,
    // model, systemPrompt, userMessage) tuple llm-response-cache.ts's own
    // header names as the safety bar for using it (see fde-service.ts's
    // identical use of callLLMJsonCached for the same reasoning). Unlike
    // chat-service.ts (whose cache key would ignore conversation `history`
    // and risk cross-conversation collisions) or task-execution-engine.ts's
    // planning call (whose SyntaxError-retry path deliberately wants a
    // fresh completion, not a replay of a truncated cached one), this call
    // site has neither hazard -- a clean fit, not a blanket "cache
    // everywhere" change.
    const { data: result, usage, cached } = await callLLMJsonCached<{
      context: string;
      actions: OrchestratedAction[];
    }>({ orgId }, modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage, {
      temperature: 0.3,
      maxTokens: 2048,
    }, modelConfig.fallback);

    const response: OrchestratorResponse = {
      eventType: typedEvent,
      entityId,
      timestamp: new Date().toISOString(),
      context: result.context || "",
      actions: (result.actions || []).map((action) => ({
        type: action.type || "general",
        label: action.label || "Suggested Action",
        description: action.description || "",
        priority: action.priority || "medium",
        payload: action.payload,
      })),
    };

    recordOrchestraExecution({
      orgId, layerKey: "task_oa", eventType: typedEvent, input: { entityId, payload: enrichedPayload },
      status: "completed", durationMs: Date.now() - startedAt,
      output: { actions: response.actions, isCustomerConfigured: modelConfig.isCustomerConfigured, cached },
      provider: modelConfig.provider, model: modelConfig.model, usage,
    });
    return NextResponse.json(response);
  } catch (error) {
    console.error("Orchestrator error:", error);
    const message =
      error instanceof Error ? error.message : "Orchestration failed";
    recordOrchestraExecution({
      orgId, layerKey: "task_oa", eventType: parsedEventType ?? "unknown", input: { entityId: parsedEntityId },
      status: "failed", durationMs: Date.now() - startedAt, output: { error: message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Default fallback actions when Groq is unavailable.
 */
function getDefaultActions(
  eventType: EventType,
  entityId: string,
  payload: Record<string, unknown>
): OrchestratedAction[] {
  const actions: OrchestratedAction[] = [];

  switch (eventType) {
    case "document.uploaded":
      actions.push({
        type: "extract_fields",
        label: "Extract Document Fields",
        description:
          "Use AI to extract key compliance fields from the uploaded document.",
        priority: "high",
        payload: { documentId: entityId },
      });
      break;

    case "item.overdue":
      actions.push({
        type: "notify_assignee",
        label: "Notify Assignee",
        description: `Send an urgent reminder to ${payload.assignedTo || "the assignee"} about this overdue item.`,
        priority: "high",
        payload: { entityId, channel: "email" },
      });
      actions.push({
        type: "escalate",
        label: "Escalate to Manager",
        description:
          "This item is overdue by " +
          (payload.daysOverdue || "?") +
          " days. Consider escalating to the department head.",
        priority: Number(payload.daysOverdue) > 30 ? "critical" : "high",
        payload: { entityId },
      });
      if (payload.complianceType) {
        actions.push({
          type: "calculate_penalty",
          label: "Calculate Penalty Exposure",
          description: `Estimate the penalty for overdue ${payload.complianceType} filing.`,
          priority: "medium",
          payload: {
            complianceType: payload.complianceType,
            daysOverdue: payload.daysOverdue,
          },
        });
      }
      break;

    case "notice.received":
      actions.push({
        type: "extract_notice",
        label: "Extract Notice Details",
        description:
          "Use AI to extract notice number, authority, demand amount, and other key fields.",
        priority: "critical",
        payload: { noticeId: entityId },
      });
      if (payload.daysUntilDeadline !== null && payload.daysUntilDeadline !== undefined) {
        actions.push({
          type: "set_deadline",
          label: `Reply Deadline: ${payload.daysUntilDeadline} days`,
          description:
            Number(payload.daysUntilDeadline) <= 7
              ? "Urgent: Reply deadline is less than a week away!"
              : `You have ${payload.daysUntilDeadline} days to reply to this notice.`,
          priority: Number(payload.daysUntilDeadline) <= 7 ? "critical" : "high",
          payload: { noticeId: entityId, daysUntilDeadline: payload.daysUntilDeadline },
        });
      }
      actions.push({
        type: "assign_team",
        label: "Assign to Compliance Team",
        description:
          "Assign this notice to the appropriate compliance team member for handling.",
        priority: "high",
        payload: { noticeId: entityId },
      });
      break;

    case "deadline.approaching":
      actions.push({
        type: "send_reminder",
        label: "Send Reminder",
        description: `Send a reminder notification to ${payload.assignedTo || "the assignee"} about the upcoming deadline.`,
        priority: "medium",
        payload: { entityId, channel: "in_app" },
      });
      actions.push({
        type: "check_readiness",
        label: "Check Filing Readiness",
        description:
          "Verify all required documents and approvals are in place before the deadline.",
        priority: "medium",
        payload: { entityId },
      });
      break;
  }

  return actions;
}