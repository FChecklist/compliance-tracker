// VERIDIAN Review Framework gap-closure, AI Engineering Quality / Code
// Structure & Modularity (Medium, "Code Modularity"): task-execution-
// engine.ts's dispatchEngine() mixed several distinct engine-category
// responsibilities into one long switch statement. This file carries the
// CRM Quick-Create engine category out of that switch, verbatim (pure code
// motion -- no logic changes), as the first slice of an incremental
// extraction. See task-execution-engine.ts's own header note on the
// remaining categories still pending the same treatment; see schema.ts's
// header for why a full one-shot split of the *other* half of this finding
// (schema.ts itself) was deliberately deferred instead -- same
// concurrent-edit-collision reasoning does not apply as strongly here since
// this file has far fewer simultaneous editors than schema.ts.
//
// Wave 4 origin comment preserved from the original call sites:
// structured, zero-LLM record creation -- the capability-tree leaf
// (capability-tree-service.ts's buildCrmQuickCreateNodes()) already
// collected every field via inputFields before this ever runs, so there is
// nothing left for an AI to interpret. userId makes createdById real
// instead of a system placeholder.

export const CRM_ENGINE_KEYS = new Set([
  "crm_create_lead_engine",
  "crm_create_opportunity_engine",
  "crm_create_activity_engine",
  "crm_create_campaign_engine",
]);

export async function dispatchCrmEngine(
  engineKey: string,
  orgId: string,
  userId: string,
  inputs: Record<string, unknown>
): Promise<unknown> {
  switch (engineKey) {
    case "crm_create_lead_engine": {
      const { createLead } = await import("@/lib/services/crm-service");
      const name = String(inputs.name ?? "").trim();
      if (!name) throw new Error("name is required");
      return createLead(
        { orgId, userId },
        {
          name,
          contactEmail: inputs.contactEmail ? String(inputs.contactEmail) : undefined,
          contactPhone: inputs.contactPhone ? String(inputs.contactPhone) : undefined,
          source: inputs.source ? String(inputs.source) : undefined,
        }
      );
    }
    case "crm_create_opportunity_engine": {
      const { createOpportunity } = await import("@/lib/services/crm-service");
      const name = String(inputs.name ?? "").trim();
      const leadId = String(inputs.leadId ?? "").trim();
      if (!name) throw new Error("name is required");
      if (!leadId) throw new Error("leadId is required");
      return createOpportunity(
        { orgId, userId },
        { name, leadId, estimatedValue: inputs.estimatedValue != null ? Number(inputs.estimatedValue) : undefined }
      );
    }
    case "crm_create_activity_engine": {
      const { createActivity } = await import("@/lib/services/crm-activities-service");
      const entityType = String(inputs.entityType ?? "");
      const entityId = String(inputs.entityId ?? "").trim();
      const activityType = String(inputs.activityType ?? "");
      const subject = String(inputs.subject ?? "").trim();
      if (!["lead", "opportunity", "account", "contact"].includes(entityType)) throw new Error("entityType must be lead, opportunity, account, or contact");
      if (!entityId) throw new Error("entityId is required");
      if (!["task", "meeting", "call"].includes(activityType)) throw new Error("activityType must be task, meeting, or call");
      if (!subject) throw new Error("subject is required");
      return createActivity(
        { orgId, userId },
        { entityType: entityType as "lead" | "opportunity" | "account" | "contact", entityId, activityType: activityType as "task" | "meeting" | "call", subject, dueDate: inputs.dueDate ? String(inputs.dueDate) : undefined }
      );
    }
    case "crm_create_campaign_engine": {
      const { createCampaign } = await import("@/lib/services/crm-campaigns-service");
      const name = String(inputs.name ?? "").trim();
      if (!name) throw new Error("name is required");
      return createCampaign({ orgId, userId }, { name, campaignType: inputs.campaignType ? String(inputs.campaignType) : undefined });
    }
    default:
      throw new Error(`No CRM engine dispatcher implemented for ${engineKey}`);
  }
}
