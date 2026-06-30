import { NextRequest, NextResponse } from "next/server";
import { db, complianceItems, notices, auditLogs } from "@/lib/db";
import { eq } from "drizzle-orm";
import { callGroqLLMJson, getGroqApiKey } from "@/lib/groq";

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

// Event-specific system prompts
function getSystemPrompt(eventType: EventType): string {
  const base = `You are Veridian AI, an intelligent compliance orchestration agent for an Indian compliance management platform.
You analyze compliance events and suggest actionable next steps.
You MUST respond with a JSON object containing: { context, actions } where actions is an array of { type, label, description, priority, payload }.
Keep descriptions concise (1-2 sentences). Priority must be one of: low, medium, high, critical.
Return ONLY valid JSON, no markdown or extra text.`;

  switch (eventType) {
    case "document.uploaded":
      return `${base}

When a document is uploaded:
- Analyze what type of document it might be (GST notice, TDS challan, PF return, etc.)
- If it looks like a notice or demand, suggest extracting its details
- If it references a compliance type, suggest creating or linking a compliance item
- Suggest assigning it to the right team based on the compliance type`;

    case "item.overdue":
      return `${base}

When a compliance item is overdue:
- Calculate the potential penalty exposure based on the compliance type and days overdue
- Suggest an escalation action (notify manager, escalate to leadership)
- Suggest drafting a reply or filing the compliance ASAP
- Flag if there are associated notices that need immediate attention
- Prioritize based on penalty severity`;

    case "notice.received":
      return `${base}

When a government notice/SCN is received:
- Suggest extracting all key fields (notice number, authority, demand amount, PAN, GSTIN, period)
- Calculate the reply deadline (typically 30 days from receipt)
- Suggest assigning to the compliance team or a specific person
- Flag the urgency based on demand amount and deadline proximity
- Suggest creating a compliance item if one doesn't exist`;

    case "deadline.approaching":
      return `${base}

When a compliance deadline is approaching (within 3-7 days):
- Suggest sending a reminder notification to the assignee
- Suggest notifying the department head
- Calculate if there are any dependencies (e.g., pending approvals, documents needed)
- Suggest priority actions to complete before the deadline
- Keep urgency proportional to days remaining`;
  }
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
  try {
    const body = await request.json();
    const { eventType, entityId, payload } = body as {
      eventType: string;
      entityId: string;
      payload?: Record<string, unknown>;
    };

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
        const item = await db.query.complianceItems.findFirst({
          where: eq(complianceItems.id, entityId),
          with: {
            department: { columns: { name: true } },
            assignedTo: { columns: { name: true, email: true } },
          },
        });
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
        const notice = await db.query.notices.findFirst({
          where: eq(notices.id, entityId),
          with: {
            department: { columns: { name: true } },
            assignedTo: { columns: { name: true, email: true } },
          },
        });
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

    // Call Groq LLM
    const systemPrompt = getSystemPrompt(typedEvent);
    const userMessage = getUserMessage(typedEvent, entityId, enrichedPayload);

    const apiKey = getGroqApiKey();
    if (!apiKey) {
      // Return sensible defaults without AI
      return NextResponse.json({
        eventType: typedEvent,
        entityId,
        timestamp: new Date().toISOString(),
        context: `Groq API key not configured. Returning default actions for ${typedEvent}.`,
        actions: getDefaultActions(typedEvent, entityId, enrichedPayload),
      });
    }

    const result = await callGroqLLMJson<{
      context: string;
      actions: OrchestratedAction[];
    }>(systemPrompt, userMessage, { temperature: 0.3, maxTokens: 2048 });

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

    return NextResponse.json(response);
  } catch (error) {
    console.error("Orchestrator error:", error);
    const message =
      error instanceof Error ? error.message : "Orchestration failed";
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
        priority: payload.daysOverdue > 30 ? "critical" : "high",
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
            payload.daysUntilDeadline <= 7
              ? "Urgent: Reply deadline is less than a week away!"
              : `You have ${payload.daysUntilDeadline} days to reply to this notice.`,
          priority: payload.daysUntilDeadline <= 7 ? "critical" : "high",
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