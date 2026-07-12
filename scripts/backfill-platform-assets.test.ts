// Priority 3 UMR (tree4-unified/50-completion-plan/08-priority3-umr-tracker.yaml,
// agent 1/umr-core). Unit tests for the pure status-mapping and
// input-building functions backfill-platform-assets.ts uses -- the actual
// DB read/write loop is NOT exercised here (the agent that wrote this
// script was explicitly told not to run it against a live database; this
// is the "verify the logic is correct via a dry-run mode or unit test"
// half of that instruction). Matches this repo's established pattern of
// testing extracted pure functions rather than a live-DB code path (see
// src/lib/services/task-service.test.ts).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  mapWorkerAgentLifecycleStatus,
  mapComputationEngineStatus,
  mapDynamicChainStatus,
  buildWorkerAgentAssetInput,
  buildComputationEngineAssetInput,
  buildPromptTemplateAssetInput,
  buildDynamicChainAssetInput,
} from "./backfill-platform-assets"

describe("mapWorkerAgentLifecycleStatus", () => {
  test("published -> active (the only genuinely live/dispatchable state)", () => {
    expect(mapWorkerAgentLifecycleStatus("published")).toBe("active")
  })
  test("retired -> archived", () => {
    expect(mapWorkerAgentLifecycleStatus("retired")).toBe("archived")
  })
  test("draft, proposed, and approved all fall back to draft (not yet live)", () => {
    expect(mapWorkerAgentLifecycleStatus("draft")).toBe("draft")
    expect(mapWorkerAgentLifecycleStatus("proposed")).toBe("draft")
    expect(mapWorkerAgentLifecycleStatus("approved")).toBe("draft")
  })
})

describe("mapComputationEngineStatus", () => {
  test("implemented -> active", () => {
    expect(mapComputationEngineStatus("implemented")).toBe("active")
  })
  test("partial and not_started both fall back to draft", () => {
    expect(mapComputationEngineStatus("partial")).toBe("draft")
    expect(mapComputationEngineStatus("not_started")).toBe("draft")
  })
})

describe("mapDynamicChainStatus", () => {
  test("approved -> active", () => {
    expect(mapDynamicChainStatus("approved")).toBe("active")
  })
  test("retired -> archived", () => {
    expect(mapDynamicChainStatus("retired")).toBe("archived")
  })
  test("draft and proposed fall back to draft", () => {
    expect(mapDynamicChainStatus("draft")).toBe("draft")
    expect(mapDynamicChainStatus("proposed")).toBe("draft")
  })
})

describe("buildWorkerAgentAssetInput", () => {
  test("maps a global-tier worker agent (orgId null) into a platform-tier asset", () => {
    const row = {
      id: "wa_1", name: "GST Filing Assistant", domain: "gst", description: "Files GST returns",
      lifecycleStatus: "published", version: 3, proposedById: null, orgId: null,
    } as any
    const input = buildWorkerAgentAssetInput(row)
    expect(input.assetType).toBe("ai_agent")
    expect(input.sourceTable).toBe("worker_agents")
    expect(input.sourceId).toBe("wa_1")
    expect(input.status).toBe("active")
    expect(input.version).toBe("3")
    expect(input.aiEnabled).toBe(true)
    expect(input.orgId).toBeNull()
  })

  test("preserves a non-null orgId for a customer/client-tier agent", () => {
    const row = {
      id: "wa_2", name: "Client Onboarding Bot", domain: null, description: null,
      lifecycleStatus: "draft", version: 1, proposedById: "user_9", orgId: "org_1",
    } as any
    const input = buildWorkerAgentAssetInput(row)
    expect(input.orgId).toBe("org_1")
    expect(input.status).toBe("draft")
    expect(input.createdBy).toBe("user_9")
  })
})

describe("buildComputationEngineAssetInput", () => {
  test("maps an implemented engine to an active, platform-tier (org-null) asset", () => {
    const row = {
      id: "ce_1", engineKey: "gst_split_engine", name: "GST Split Engine", category: "GST Engine",
      description: "Splits GST into CGST/SGST/IGST", status: "implemented",
    } as any
    const input = buildComputationEngineAssetInput(row)
    expect(input.assetType).toBe("computation_engine")
    expect(input.status).toBe("active")
    expect(input.aiEnabled).toBe(false)
    expect(input.orgId).toBeNull()
    expect(input.searchKeywords).toBe("gst_split_engine")
  })
})

describe("buildPromptTemplateAssetInput", () => {
  test("always registers as active, platform-tier, AI-enabled", () => {
    const row = {
      id: "pt_1", templateKey: "chat.ai_thread_system", displayName: "Chat System Prompt", description: "Core chat system prompt",
    } as any
    const input = buildPromptTemplateAssetInput(row)
    expect(input.assetType).toBe("prompt")
    expect(input.status).toBe("active")
    expect(input.aiEnabled).toBe(true)
    expect(input.orgId).toBeNull()
  })
})

describe("buildDynamicChainAssetInput", () => {
  test("joins pathLabels into a readable name when present", () => {
    const row = {
      id: "dc_1", orgId: "org_1", modePill: "compliance", pathKeys: ["a", "b"],
      pathLabels: ["Compliance", "Mark Completed"], moduleRef: "compliance_item",
      description: "desc", createdById: "user_1", status: "approved",
    } as any
    const input = buildDynamicChainAssetInput(row)
    expect(input.name).toBe("Compliance > Mark Completed")
    expect(input.assetType).toBe("dynamic_chain")
    expect(input.status).toBe("active")
    expect(input.orgId).toBe("org_1")
  })

  test("falls back to modePill when pathLabels is empty", () => {
    const row = {
      id: "dc_2", orgId: "org_2", modePill: "erp", pathKeys: [], pathLabels: [],
      moduleRef: null, description: null, createdById: null, status: "draft",
    } as any
    const input = buildDynamicChainAssetInput(row)
    expect(input.name).toBe("erp")
    expect(input.status).toBe("draft")
  })

  test("dynamic_chains.orgId is NOT NULL in the source schema, so this is always org-scoped, never platform-tier", () => {
    const row = {
      id: "dc_3", orgId: "org_3", modePill: "pms", pathKeys: [], pathLabels: [],
      moduleRef: null, description: null, createdById: null, status: "retired",
    } as any
    const input = buildDynamicChainAssetInput(row)
    expect(input.orgId).toBe("org_3")
    expect(input.status).toBe("archived")
  })
})
