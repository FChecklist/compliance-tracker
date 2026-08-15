import { db, orchestraLayers, customerModelConfig, clientModelConfig, sharedPoolAllocations, aiModelRegistry } from "@/lib/db";
import { and, eq, isNull, isNotNull, or } from "drizzle-orm";
import { decryptApiKey } from "@/lib/ai-config-crypto";
import { canIncurCost } from "@/lib/cost-guard";
import { callLLM, LLMHttpError, type LLMProvider, type LLMFallback } from "@/lib/llm-client";

export type ResolvedModelConfig = {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  isCustomerConfigured: boolean;
  // Wave 72 (AI_OS_CERTIFICATION.md §2.5, model-switching-on-failure): the
  // platform's own OpenRouter default, when it's actually configured and
  // isn't just a repeat of the primary -- passed straight through to
  // callLLM/callLLMJson's optional `fallback` parameter. undefined when
  // there's genuinely nothing sensible to fall back to (no OPENROUTER_API_KEY
  // configured, or the primary already IS the platform OpenRouter default).
  fallback?: LLMFallback;
};

// VERIDIAN Review Framework remediation (AI Router registry-backed model
// resolution, 2026-07-19): the 4 constants below (PLATFORM_DEFAULT_*,
// PLATFORM_FALLBACK_MODEL, CEREBRAS_GPT_OSS_MODEL, ESCALATED_*) used to be
// the live values this resolver dispatched against directly -- swapping any
// of them required a code deploy, contradicting the platform's own
// "model-agnostic, swappable without a deploy" principle. They are now the
// LAST-RESORT fallback literals only: getRoleModel() below looks each one
// up by a named `role` in platform.ai_model_registry first (a DB insert
// changes it live), and only falls back to these hardcoded pairs when the
// registry has no active row for that role or the lookup itself errors --
// logging a warning either way so a silent registry gap is visible in logs.
// The FAILOVER SEQUENCE/DECISION LOGIC itself (platformFallbackFor() below)
// stays entirely in code, unchanged -- only WHICH model/provider fills each
// named slot moved to data.
const PLATFORM_FALLBACK_MODEL_FALLBACK = "meta-llama/llama-3.3-70b-instruct:free"

// Wave (2026-07-10, founder directive): platform-default floor for text
// orchestration, replacing the OpenRouter llama-3.3-70b-instruct default
// (Wave 45) now that GROQ_API_KEY is live. GPT-OSS-120B is meaningfully
// stronger than llama-3.3-70b while staying just as fast/cheap on Groq's
// hardware -- this is the FLOOR every org gets before configuring anything
// of their own, not a ceiling: GLM-5.2/DeepSeek/Claude remain available
// higher up this same resolution chain (customer BYO config, shared pool)
// for anything needing real reasoning, per the founder's explicit 90-day
// "don't cut corners on cost" directive. Verified live against
// api.groq.com/openai/v1/models 2026-07-10 as "openai/gpt-oss-120b".
const PLATFORM_DEFAULT_PROVIDER_FALLBACK: LLMProvider = "groq"
const PLATFORM_DEFAULT_MODEL_FALLBACK = "openai/gpt-oss-120b";
// PROJEXA load test finding (2026-07-10, PROJEXA_LOAD_TEST_RESULTS.md §5
// Incident 4): Groq's free tier for openai/gpt-oss-120b has a 200,000
// tokens/day (TPD) cap, on top of its 30 RPM / 8,000 TPM limits --
// confirmed live by exhausting it with a single 100-persona synthetic-data
// generation batch. GPT-OSS-120B is a reasoning model, so real completion
// tokens go to hidden chain-of-thought before the visible answer, burning
// through all three limits faster than the visible response size would
// suggest. RPM/TPM throttling alone cannot compensate for an already-
// exhausted daily cap -- any same-day batch job heavy enough to approach
// ~200K tokens against this floor-tier key should fail over to Cerebras
// (see platformFallbackFor() below, already same-model failover) rather
// than retry-loop against Groq for the rest of the day.

// Wave (2026-07-10, founder directive): Cerebras added as a second host for
// the SAME floor-tier model -- "Groq is free, Cerebras is paid," loaded
// with $10 of prepaid credit specifically as a reliability backstop, not a
// second cheap option to shop between. Cerebras's own API returns this
// model under a different id than Groq's ("gpt-oss-120b", no "openai/"
// prefix -- confirmed live via api.cerebras.ai/v1/models). Kept as its own
// named constant rather than inlined so platformFallbackFor() below reads
// as an obvious one-line policy: same model, different (paid) infra, only
// when the free primary is actually down.
const CEREBRAS_GPT_OSS_MODEL_FALLBACK = "gpt-oss-120b"

// Wave (2026-07-10, founder directive): the model a floor-tier call escalates
// TO when src/lib/floor-tier-escalation.ts's deterministic signals fire.
// GLM-5.2, already pinned to OpenRouter provider "DeepInfra" in
// llm-client.ts's OPENROUTER_PROVIDER_PREFERENCE. Callers must only use this
// for requests that resolved to `isCustomerConfigured: false` -- never
// overrides an org's own BYO model choice. Declared here (moved up from
// beside escalatedPlatformConfig() below) so platformFallbackFor() can
// reference it directly instead of forward-referencing a later const.
const ESCALATED_PROVIDER_FALLBACK: LLMProvider = "openrouter"
const ESCALATED_MODEL_FALLBACK = "z-ai/glm-5.2"

// ─── Registry-backed named-role lookup (AI Router follow-up, 2026-07-19) ──
// Short in-process TTL cache, same pattern as mother-router.ts's own
// policyCache -- a registry row change is picked up on this process's next
// lookup once the TTL elapses (or immediately via
// invalidateRoleRegistryCache()), no app restart required. Per-instance
// only in a multi-instance deployment, same honest limitation mother-
// router.ts's own cache documents.
const ROLE_REGISTRY_CACHE_TTL_MS = 60_000
type RoleModel = { provider: LLMProvider; model: string }
const roleRegistryCache = new Map<string, { fetchedAt: number; value: RoleModel | null }>()

/** Forces the next getRoleModel() lookup for every named role to re-fetch from ai_model_registry instead of waiting out ROLE_REGISTRY_CACHE_TTL_MS. Call after writing/activating a new role row if the change needs to take effect immediately in this process. */
export function invalidateRoleRegistryCache(): void {
  roleRegistryCache.clear()
}

/**
 * Resolves a named failover-chain role ('platform_default' | 'platform_fallback'
 * | 'cerebras_failover' | 'escalated_default') from platform.ai_model_registry's
 * `role` column. Fails safe to `fallback` (today's hardcoded literal) on any
 * DB error OR when no active row is registered for that role -- a registry
 * gap or hiccup must never be the reason the platform-default AI path
 * breaks. Logs a warning whenever the fallback path is actually hit, so a
 * silent registry gap is still visible in logs even though it doesn't break
 * anything.
 */
async function getRoleModel(role: string, fallback: RoleModel): Promise<RoleModel> {
  const cached = roleRegistryCache.get(role)
  if (cached && Date.now() - cached.fetchedAt < ROLE_REGISTRY_CACHE_TTL_MS) {
    return cached.value ?? fallback
  }

  try {
    const row = await db.query.aiModelRegistry.findFirst({
      where: and(eq(aiModelRegistry.role, role), eq(aiModelRegistry.status, "active")),
    })
    const value: RoleModel | null = row ? { provider: row.provider as LLMProvider, model: row.model } : null
    roleRegistryCache.set(role, { fetchedAt: Date.now(), value })
    if (!value) {
      console.warn(`[orchestra-model-resolver] no active ai_model_registry row for role='${role}' -- falling back to hardcoded literal ${fallback.provider}/${fallback.model}`)
    }
    return value ?? fallback
  } catch (err) {
    console.warn(`[orchestra-model-resolver] ai_model_registry lookup failed for role='${role}', falling back to hardcoded literal ${fallback.provider}/${fallback.model}:`, err)
    return fallback
  }
}

const getPlatformDefault = () => getRoleModel("platform_default", { provider: PLATFORM_DEFAULT_PROVIDER_FALLBACK, model: PLATFORM_DEFAULT_MODEL_FALLBACK })
const getPlatformFallback = () => getRoleModel("platform_fallback", { provider: "openrouter", model: PLATFORM_FALLBACK_MODEL_FALLBACK })
const getCerebrasFailover = () => getRoleModel("cerebras_failover", { provider: "cerebras", model: CEREBRAS_GPT_OSS_MODEL_FALLBACK })
const getEscalatedDefault = () => getRoleModel("escalated_default", { provider: ESCALATED_PROVIDER_FALLBACK, model: ESCALATED_MODEL_FALLBACK })

// VERIDIAN Review Framework remediation (AI Failover & High Availability
// gap, 2026-07-18): before this, ONLY the floor tier (below) had a
// same-quality-class failover -- the escalated tier (ESCALATED_MODEL,
// what a floor-tier call upgrades to when floor-tier-escalation.ts's
// signals fire, see escalatedPlatformConfig() below) and every BYO/
// customer-configured "premium" model fell straight through to the
// generic OpenRouter free fallback (PLATFORM_FALLBACK_MODEL, a much
// weaker model) -- a real quality cliff for exactly the calls judged
// important enough to escalate to begin with. Same "same tier, different
// infra" reasoning as the Cerebras branch below: if GLM-5.2 itself is
// down, retry on a different real reasoning model (DeepSeek V4 Pro --
// already judgment/integrative-eligible per model-tier-eligibility.ts,
// and pinned to OpenRouter provider "DeepSeek" in llm-client.ts's
// OPENROUTER_PROVIDER_PREFERENCE, genuinely separate upstream infra from
// GLM-5.2's DeepInfra routing) instead of collapsing all the way to the
// free floor model. Deliberately scoped to the ESCALATED_MODEL only, not
// every arbitrary BYO/premium config: an org's own BYO model choice has no
// platform-known "same-tier sibling" to fail over to -- inventing one
// would be guessing at a customer's intent, not a real reliability
// improvement, so those configs still fall through to the generic
// OpenRouter fallback below (the only universally-safe default).
const ESCALATED_FALLBACK_MODEL = "deepseek/deepseek-v4-pro"

async function platformFallbackFor(primary: { provider: LLMProvider; model: string }): Promise<LLMFallback | undefined> {
  // Same-model failover for the floor tier specifically: if Groq's
  // gpt-oss-120b is the primary and it fails, retry the SAME model on
  // Cerebras rather than dropping to a weaker free OpenRouter model --
  // preserves quality on failover, not just uptime. Falls through to the
  // generic OpenRouter fallback below for every other primary (including
  // when CEREBRAS_API_KEY isn't configured).
  const platformDefault = await getPlatformDefault()
  if (primary.provider === platformDefault.provider && primary.model === platformDefault.model) {
    const cerebrasFailover = await getCerebrasFailover()
    const cerebrasKey = platformApiKeyFor(cerebrasFailover.provider)
    if (cerebrasKey) return { provider: cerebrasFailover.provider, model: cerebrasFailover.model, apiKey: cerebrasKey }
  }

  // Escalated-tier failover -- see ESCALATED_FALLBACK_MODEL's own comment
  // above. Checked before the generic fallback below so it takes priority
  // whenever OPENROUTER_API_KEY is configured (the same key both the
  // primary escalated call and this fallback use).
  const escalatedDefault = await getEscalatedDefault()
  if (primary.provider === escalatedDefault.provider && primary.model === escalatedDefault.model) {
    const openrouterKey = process.env.OPENROUTER_API_KEY
    if (openrouterKey) return { provider: "openrouter", model: ESCALATED_FALLBACK_MODEL, apiKey: openrouterKey }
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return undefined;
  const platformFallback = await getPlatformFallback()
  if (primary.provider === platformFallback.provider && primary.model === platformFallback.model) return undefined;
  return { provider: platformFallback.provider, model: platformFallback.model, apiKey };
}

// Wave 45: the platform-default path previously hardcoded process.env.GROQ_API_KEY
// regardless of what layer.defaultModelConfig.provider actually said -- a real
// bug (silently broken for any layer ever pointed at a non-Groq provider).
// Picks the right env var for whichever provider is actually configured.
export function platformApiKeyFor(provider: LLMProvider): string | undefined {
  switch (provider) {
    case "groq": return process.env.GROQ_API_KEY;
    case "openrouter": return process.env.OPENROUTER_API_KEY;
    case "openai": return process.env.OPENAI_API_KEY;
    case "anthropic": return process.env.ANTHROPIC_API_KEY;
    case "google": return process.env.GOOGLE_API_KEY;
    case "cerebras": return process.env.CEREBRAS_API_KEY;
  }
}

/**
 * Returns the escalation target for a floor-tier call, or null if
 * OPENROUTER_API_KEY isn't configured (nothing sensible to escalate to).
 *
 * Bug fix (VERIDIAN Review Framework remediation, AI Failover, 2026-07-18):
 * this never populated `fallback` at all before -- every other real config
 * returned by this file (resolveModelConfig/resolveClientModelConfig/
 * resolvePlatformModelConfig, all below) sets it via platformFallbackFor(),
 * but this function built its ResolvedModelConfig by hand and skipped that
 * call entirely. Net effect: chat-service.ts's escalated retry
 * (`callLLM(..., escalated.fallback)`) always ran with `fallback: undefined`
 * -- an escalated call had literally NO failover path, not even the generic
 * one every other call site gets. Now goes through the same
 * platformFallbackFor() every other branch uses, which (see that function)
 * resolves this specific primary to the new DeepSeek V4 Pro same-tier
 * failover.
 */
export async function escalatedPlatformConfig(): Promise<ResolvedModelConfig | null> {
  const escalatedDefault = await getEscalatedDefault()
  const apiKey = platformApiKeyFor(escalatedDefault.provider)
  if (!apiKey) return null
  return {
    provider: escalatedDefault.provider, model: escalatedDefault.model, apiKey, isCustomerConfigured: false,
    fallback: await platformFallbackFor({ provider: escalatedDefault.provider, model: escalatedDefault.model }),
  }
}

// ─── Source-type-aware routing (D26.B5.S1, ai-os/STATUS-REPORT.md item 9) ──
// A prior dispatch investigated wiring a `source_type` signal all the way
// through orchestra-model-resolver.ts's ~23 call sites and found it needed
// genuinely new architecture -- correctly scoped as too large for a narrow
// slice, and NOT attempted here. What this wave does instead: the one
// concrete precedent that already existed for "this resolved provider needs
// a DIFFERENT specific model for this particular KIND of call, not the
// layer's default text model" -- document-extraction-service.ts's own
// VISION_MODEL_OVERRIDES map plus its provider-then-fallback-provider
// lookup logic -- generalized into this resolver itself, exactly as the
// dispatch brief asks, rather than reinvented a second time somewhere else.
//
// Deliberately NOT attempted: a new "Microsoft AI" LLMProvider integration.
// That's a real, separate initiative (a new provider in llm-client.ts's
// LLMProvider union, a new API client, new env vars/pricing) -- out of
// scope for "make the resolver source-type-aware in principle."
//
// Design: keyed by sourceType FIRST, then provider -- a flat Provider->model
// map (like the original VISION_MODEL_OVERRIDES) can only express one
// source type at a time; different source types can need different override
// models on the very same provider (e.g. a vision-capable model here, a
// code-specialized model there), so the table needs both dimensions.
// `sourceType` is free text (matching this codebase's established choice
// for `entityRelationships.sourceType`/`embeddings.entityType`, schema.ts)
// -- an enum would need a migration every time a new source type wants to
// register overrides.
const SOURCE_TYPE_MODEL_OVERRIDES: Record<string, Partial<Record<LLMProvider, string>>> = {
  // The exact map document-extraction-service.ts used to own locally --
  // moved here verbatim (not re-guessed) and wired back in below.
  //
  // Wave A (VERIDIAN Review Framework remediation, 2026-07-17, security/bug
  // quick-fix item 4): this map had NO "groq" entry -- a real bug, not a
  // disclosed gap. PLATFORM_DEFAULT_PROVIDER above is "groq" (a text-only
  // reasoning model), which is what every org gets before configuring any
  // BYO model of their own (the platform "floor tier"). For that entire
  // population, applySourceTypeOverride() found no override for the primary
  // provider ("groq") and then checked the fallback -- platformFallbackFor()'s
  // Cerebras same-model failover, live when CEREBRAS_API_KEY is configured.
  // "cerebras" ALSO had no entry in this map, so the lookup fell through
  // both branches and returned null -- document-extraction-service.ts then
  // logged a "failed" orchestra execution and skipped extraction entirely,
  // silently, for every org on the platform default. Root cause was this
  // map's missing groq entry, not document-extraction-service.ts itself
  // (which correctly treats a null result as "cannot proceed").
  //
  // Fix: registered groq's own real vision-capable model, verified live via
  // console.groq.com/docs/vision (2026-07-17) --
  // meta-llama/llama-4-scout-17b-16e-instruct, which replaced Groq's
  // decommissioned llama-3.2-*-vision-preview models and supports image
  // input via the standard chat-completions endpoint, exactly like
  // callVisionOpenAICompatible() already sends (llm-client.ts). Because
  // applySourceTypeOverride() checks the PRIMARY provider first and returns
  // immediately once found, this one addition resolves the entire
  // floor-tier gap without ever needing to reach the Cerebras fallback
  // branch. A pricing row was also added for this model in llm-client.ts's
  // MODEL_PRICING -- without it, estimateCostUsd() would silently return
  // null for every extraction call that resolves here, the same class of
  // gap this fix closes.
  //
  // Cerebras deliberately still has NO entry here -- verified live via
  // inference-docs.cerebras.ai (2026-07-17): Cerebras Cloud does not
  // currently offer any vision/multimodal model. Registering a guessed
  // model id for it would fail every request that actually reached that
  // fallback branch with a confusing upstream error instead of this map's
  // honest, already-handled "no override registered" null -- worse than the
  // current documented behavior, so left unregistered rather than faked.
  vision_document_extraction: {
    groq: "meta-llama/llama-4-scout-17b-16e-instruct",
    openai: "gpt-4o",
    anthropic: "claude-sonnet-5",
    google: "gemini-2.0-flash",
    openrouter: "openai/gpt-4o-mini",
  },
}

/**
 * Applies a registered source-type override to an already-resolved config,
 * generalizing document-extraction-service.ts's old inline vision-override
 * logic (provider override, else fallback-provider override, else "no
 * usable config for this source type"). Additive and fully backward
 * compatible: `sourceType` undefined (every one of the ~23 existing call
 * sites, unchanged by this wave) is a no-op passthrough.
 *
 * Returns null -- same "cannot proceed" contract every other branch of
 * resolveModelConfig/resolvePlatformModelConfig already uses -- ONLY when
 * `sourceType` names a REGISTERED override table but neither the primary
 * nor fallback provider has an entry in it (the config genuinely cannot
 * serve this source type). An unregistered/unknown sourceType is never
 * treated as an error -- it passes the original config through unchanged,
 * since nothing has declared that source type needs special handling.
 */
export function applySourceTypeOverride(config: ResolvedModelConfig, sourceType?: string): ResolvedModelConfig | null {
  if (!sourceType) return config
  const overrides = SOURCE_TYPE_MODEL_OVERRIDES[sourceType]
  if (!overrides) return config

  const primaryModel = overrides[config.provider]
  if (primaryModel) return { ...config, model: primaryModel }

  if (config.fallback) {
    const fallbackModel = overrides[config.fallback.provider]
    if (fallbackModel) {
      return {
        provider: config.fallback.provider,
        model: fallbackModel,
        apiKey: config.fallback.apiKey,
        isCustomerConfigured: config.isCustomerConfigured,
        fallback: config.fallback,
      }
    }
  }

  return null
}

export type ConnectionTestResult = { ok: true } | { ok: false; error: string };

// Review Framework remediation, Wave B (BYO-AI-model): a real connectivity
// check for an org admin's proposed provider/model/key BEFORE it's persisted
// to customer_model_config. Before this, POST /api/settings/model-config
// only validated shape (provider is one of the 4 allowed enum values,
// modelName is a non-empty string) -- a bad/expired key or a misspelled
// model name saved silently and only surfaced later as a confusing failure
// deep inside some unrelated Orchestra Layer call, with nothing pointing an
// admin back to "your BYO config is broken."
//
// Makes exactly ONE real completion call against the given provider (via
// the same callLLM() every real Orchestra Layer call already goes through,
// so this is testing the actual code path, not a parallel one) with a tiny
// maxTokens and no fallback -- a connection test that itself silently fell
// back to the platform default would defeat the point. Never logs the key
// (callLLM/dispatchLLM never log it either); on failure, returns the
// provider's own error message truncated to something safe to surface to
// an admin in a toast, not a raw stack trace.
export async function testProviderConnection(
  provider: LLMProvider,
  model: string,
  apiKey: string
): Promise<ConnectionTestResult> {
  try {
    await callLLM(
      provider,
      model,
      apiKey,
      "You are a connection test. Reply with only the single word OK.",
      "ping",
      { temperature: 0, maxTokens: 5 }
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof LLMHttpError) {
      const detail = error.message.length > 300 ? `${error.message.slice(0, 300)}...` : error.message;
      return { ok: false, error: `Provider rejected the request (HTTP ${error.status ?? "unknown"}): ${detail}` };
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, error: message.length > 300 ? `${message.slice(0, 300)}...` : message };
  }
}

/**
 * Resolves which provider/model/key an org should use for a given Orchestra
 * Layer: a customer's own `customer_model_config` row (BYO) if one is active
 * for that layer specifically, else one that applies to all layers
 * (orchestra_layer_id IS NULL), else the layer's own `default_model_config`
 * (platform default, currently always Groq).
 *
 * Uses the raw `db` client -- `customer_model_config`/`orchestra_layers`
 * lookups here are a platform-level resolution step that runs before any
 * tenant-scoped transaction, not a per-request user action needing RLS.
 * The BYO API key itself is decrypted here and must never be returned to
 * a client -- callers use it to make the LLM call and discard it.
 *
 * This function's own per-ORG resolution logic is untouched by Wave 18's
 * Shared AI Resource Pool -- an org's own key is never substituted with
 * another org's here, by construction (there is no code path in this
 * function that reads any other org's customer_model_config row). See
 * resolvePlatformModelConfig() below for the separate, platform-scoped path.
 *
 * `sourceType` (D26.B5.S1, optional, default undefined): when provided and
 * SOURCE_TYPE_MODEL_OVERRIDES has a registered table for it, the resolved
 * model is swapped for that source type's override (see
 * applySourceTypeOverride() above) before being returned -- e.g. passing
 * "vision_document_extraction" ensures the returned config can actually see
 * images, regardless of which text model the layer/org would otherwise
 * resolve to. Every existing caller (all ~23 call sites predating this
 * wave) omits this argument and is completely unaffected.
 */
export async function resolveModelConfig(orgId: string, layerKey: string, sourceType?: string): Promise<ResolvedModelConfig | null> {
  const layer = await db.query.orchestraLayers.findFirst({ where: eq(orchestraLayers.layerKey, layerKey) });
  if (!layer) return null;

  // Wave 172 (area 11, Cost management): checked here, the one real
  // choke point every product_orchestra dispatch resolves a model through,
  // rather than after-the-fact in token-usage-service.ts's logging (which
  // runs only once the LLM call already happened -- too late to block
  // spend). Returns null like every other "can't proceed" branch in this
  // function; callers already treat null as "do not make this call."
  // No-op (never returns false) when costCapEnforcementEnabled is off, the
  // default for every org -- this is opt-in active control, not a
  // retroactively imposed limit.
  const costCheck = await canIncurCost(orgId);
  if (!costCheck.allowed) {
    console.warn(`[cost-guard] blocked resolveModelConfig for org ${orgId}: ${costCheck.reason}`);
    return null;
  }

  const customerConfig = await db.query.customerModelConfig.findFirst({
    where: and(
      eq(customerModelConfig.orgId, orgId),
      eq(customerModelConfig.isActive, true),
      or(eq(customerModelConfig.orchestraLayerId, layer.id), isNull(customerModelConfig.orchestraLayerId))
    ),
    // Layer-specific configs take priority over "applies to all layers" ones:
    // ascending sort puts non-null orchestra_layer_id first (Postgres's
    // default NULLS LAST for ASC), so the more specific row wins.
    orderBy: (t, { asc }) => asc(t.orchestraLayerId),
  });

  if (customerConfig?.encryptedApiKey && customerConfig.modelName) {
    // Wave 18: lastUsedAt reflects the org's OWN real usage too, not just
    // pool-borrowing -- otherwise a heavily-used config could look "idle" to
    // the shared pool just because it had never been borrowed yet. Fire-and-
    // forget, same non-blocking pattern as apiKeys.lastUsedAt elsewhere.
    db.update(customerModelConfig).set({ lastUsedAt: new Date() }).where(eq(customerModelConfig.id, customerConfig.id)).then(() => {});

    const apiKey = await decryptApiKey(customerConfig.encryptedApiKey);
    const provider = customerConfig.provider as LLMProvider;
    const model = customerConfig.modelName;
    return applySourceTypeOverride({
      provider,
      model,
      apiKey,
      isCustomerConfigured: true,
      fallback: await platformFallbackFor({ provider, model }),
    }, sourceType);
  }

  const defaultConfig = layer.defaultModelConfig as { provider?: string; model?: string };
  let provider = defaultConfig.provider as LLMProvider | undefined;
  let model = defaultConfig.model;
  if (!provider || !model) {
    const platformDefault = await getPlatformDefault();
    provider = provider ?? platformDefault.provider;
    model = model ?? platformDefault.model;
  }
  const apiKey = platformApiKeyFor(provider);
  if (!apiKey) return null;

  return applySourceTypeOverride(
    { provider, model, apiKey, isCustomerConfigured: false, fallback: await platformFallbackFor({ provider, model }) },
    sourceType
  );
}

/**
 * Wave 45 (VAIOS Layer 1-4 OpenRouter wiring, PLATFORM_STRATEGY.md §26) --
 * Layer 3 (client) resolution: a real, confirmed gap. Layers 1/2/4
 * (platform/org/user) already had a model-resolution mechanism; a client
 * (e.g. a CA/legal firm's individual end-client under an org) had none.
 * Most-specific-scope-wins, same pattern as resolvePageAgentModelConfig()'s
 * user->org->platform chain: a client-specific row wins, else falls back to
 * the client's own org's resolution (resolveModelConfig), which itself
 * falls back to the platform default.
 */
export async function resolveClientModelConfig(clientId: string, orgId: string, layerKey: string): Promise<ResolvedModelConfig | null> {
  const layer = await db.query.orchestraLayers.findFirst({ where: eq(orchestraLayers.layerKey, layerKey) });
  if (!layer) return null;

  const clientConfig = await db.query.clientModelConfig.findFirst({
    where: and(
      eq(clientModelConfig.clientId, clientId),
      eq(clientModelConfig.isActive, true),
      or(eq(clientModelConfig.orchestraLayerId, layer.id), isNull(clientModelConfig.orchestraLayerId))
    ),
    orderBy: (t, { asc }) => asc(t.orchestraLayerId),
  });

  if (clientConfig?.encryptedApiKey && clientConfig.modelName) {
    db.update(clientModelConfig).set({ lastUsedAt: new Date() }).where(eq(clientModelConfig.id, clientConfig.id)).then(() => {});
    const apiKey = await decryptApiKey(clientConfig.encryptedApiKey);
    const provider = clientConfig.provider as LLMProvider;
    const model = clientConfig.modelName;
    return {
      provider,
      model,
      apiKey,
      isCustomerConfigured: true,
      fallback: await platformFallbackFor({ provider, model }),
    };
  }

  return resolveModelConfig(orgId, layerKey);
}

const IDLE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Wave 18 (VAIOS Shared AI Resource Pool, constitution refinement #10) --
 * resolves a model for the PLATFORM's OWN internal orchestration work, never
 * a customer org's workflow. Deliberately takes no `orgId` parameter at all:
 * that is the structural guarantee this can never be mistaken for (or
 * accidentally reused as) a customer org's resolution path. Falls back to
 * borrowing an idle, explicitly opted-in org's BYO config only when the
 * platform has no default key configured for this layer -- "Layer 1 needs
 * more capacity to do orchestra, so it takes from all available models as
 * per need" (the user's own framing). Never lends to another org; never
 * silently substitutes a customer's own resolution with someone else's key.
 *
 * `sourceType` (D26.B5.S1, optional, default undefined): same contract as
 * resolveModelConfig()'s -- see applySourceTypeOverride() above. Applied to
 * whichever branch actually resolves (platform default OR shared-pool
 * borrow), so a source-type override is honored regardless of which path
 * this function takes.
 */
export async function resolvePlatformModelConfig(layerKey: string, sourceType?: string): Promise<ResolvedModelConfig | null> {
  const layer = await db.query.orchestraLayers.findFirst({ where: eq(orchestraLayers.layerKey, layerKey) });
  if (!layer) return null;

  const defaultConfig = layer.defaultModelConfig as { provider?: string; model?: string };
  let provider = defaultConfig.provider as LLMProvider | undefined;
  let model = defaultConfig.model;
  if (!provider || !model) {
    const platformDefault = await getPlatformDefault();
    provider = provider ?? platformDefault.provider;
    model = model ?? platformDefault.model;
  }
  const platformApiKey = platformApiKeyFor(provider);
  if (platformApiKey) {
    return applySourceTypeOverride(
      { provider, model, apiKey: platformApiKey, isCustomerConfigured: false, fallback: await platformFallbackFor({ provider, model }) },
      sourceType
    );
  }

  return borrowFromSharedPool(layerKey, layer.id, sourceType);
}

async function borrowFromSharedPool(layerKey: string, orchestraLayerId: string, sourceType?: string): Promise<ResolvedModelConfig | null> {
  const idleCutoff = new Date(Date.now() - IDLE_THRESHOLD_MS);

  const candidate = await db.query.customerModelConfig.findFirst({
    where: and(
      eq(customerModelConfig.isActive, true),
      eq(customerModelConfig.sharedPoolEligible, true),
      isNotNull(customerModelConfig.encryptedApiKey),
      or(eq(customerModelConfig.orchestraLayerId, orchestraLayerId), isNull(customerModelConfig.orchestraLayerId))
    ),
    // Most-idle first: never-used (lastUsedAt IS NULL) configs sort first
    // under Postgres's default NULLS LAST for ASC... explicit ordering
    // below handles that correctly either way via the idle-cutoff filter.
    orderBy: (t, { asc: ascOrder }) => ascOrder(t.lastUsedAt),
  });

  if (!candidate?.encryptedApiKey || !candidate.modelName) return null;
  if (candidate.lastUsedAt && candidate.lastUsedAt > idleCutoff) return null; // in active use by its own org right now, not actually idle

  await db.insert(sharedPoolAllocations).values({
    lenderOrgId: candidate.orgId,
    purpose: `${layerKey}_platform_orchestration`,
    customerModelConfigId: candidate.id,
    orchestraLayerKey: layerKey,
  });
  await db.update(customerModelConfig).set({ lastUsedAt: new Date() }).where(eq(customerModelConfig.id, candidate.id));

  const apiKey = await decryptApiKey(candidate.encryptedApiKey);
  const provider = candidate.provider as LLMProvider;
  const model = candidate.modelName;
  return applySourceTypeOverride({
    provider,
    model,
    apiKey,
    isCustomerConfigured: true,
    fallback: await platformFallbackFor({ provider, model }),
  }, sourceType);
}
