// Wave 113: VERIDIAN SALES AI — visitor intelligence + conversion engine.
//
// Everything the public pages report (page views, section reach, CTA clicks,
// exits, offers) lands here, and everything Sales HQ reads back out (funnel
// stats, drop-off analysis, on-demand AI analysis) comes from here. Uses the
// raw `db` client throughout: these are platform-owned tables with no tenant
// to scope by — the same posture sales-engine-service.ts established.
//
// The exit-intent offer engine is deliberately RULES-FIRST, AI-second: the
// offer decision must return in the milliseconds before a visitor's cursor
// leaves the tab, so it's a deterministic ladder keyed on what we actually
// know (visit count, product, sections reached). The AI layer (task_oa via
// the platform resolver) runs asynchronously in Sales HQ, where a human
// reads its funnel analysis and tunes the ladder — cognition where it has
// time to think, rules where latency rules.
import { db, visitorSessions, visitorEvents } from "@/lib/db"
import { eq, sql, desc, gte, and } from "drizzle-orm"
import { resolvePlatformModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"

export type TrackPayload = {
  visitorId: string
  eventType: "page_view" | "section_view" | "cta_click" | "exit" | "offer_shown" | "offer_clicked" | "offer_dismissed"
  page: string
  productKey?: string
  section?: string
  metadata?: Record<string, unknown>
  referrer?: string
  userAgent?: string
}

const VALID_EVENTS = new Set(["page_view", "section_view", "cta_click", "exit", "offer_shown", "offer_clicked", "offer_dismissed"])
const VALID_PRODUCTS = new Set(["cognitive", "office", "the_firm", "forge", "facilities_management"])

export async function recordVisitorEvent(p: TrackPayload): Promise<void> {
  const visitorId = p.visitorId?.slice(0, 64)
  if (!visitorId || !VALID_EVENTS.has(p.eventType)) return
  const page = (p.page || "/").slice(0, 200)
  const productKey = p.productKey && VALID_PRODUCTS.has(p.productKey) ? p.productKey : null

  // Upsert the session. A "visit" bumps only on page_view so section/exit
  // pings within the same page load don't inflate visit_count.
  const existing = await db.query.visitorSessions.findFirst({ where: eq(visitorSessions.visitorId, visitorId) })
  if (!existing) {
    await db.insert(visitorSessions).values({
      visitorId,
      firstPage: page,
      lastPage: page,
      referrer: p.referrer?.slice(0, 300) ?? null,
      userAgent: p.userAgent?.slice(0, 300) ?? null,
    }).onConflictDoNothing()
  } else {
    await db.update(visitorSessions).set({
      lastSeenAt: new Date(),
      lastPage: page,
      ...(p.eventType === "page_view" && existing.lastSeenAt < new Date(Date.now() - 30 * 60 * 1000)
        ? { visitCount: existing.visitCount + 1 }
        : {}),
    }).where(eq(visitorSessions.visitorId, visitorId))
  }

  await db.insert(visitorEvents).values({
    visitorId,
    eventType: p.eventType,
    page,
    productKey,
    section: p.section?.slice(0, 100) ?? null,
    metadata: p.metadata ?? null,
  })
}

// Called from autoProvisionUser() when a signup carried a visitor id —
// closes the loop from anonymous visit to converted tenant. Never throws.
export async function recordVisitorConversion(visitorId: string, orgId: string): Promise<void> {
  try {
    await db.update(visitorSessions)
      .set({ convertedOrgId: orgId, convertedAt: new Date() })
      .where(eq(visitorSessions.visitorId, visitorId))
    await db.insert(visitorEvents).values({
      visitorId, eventType: "signup_completed", page: "/signup", metadata: { orgId },
    })
  } catch (err) {
    console.warn("visitor conversion record failed (non-blocking):", err)
  }
}

export type ExitOffer = {
  code: string
  headline: string
  body: string
  discountPct: number
  validHours: number
}

// The deterministic offer ladder. Returning visitors get the strongest
// offer (they're comparison-shopping); pricing-section viewers get urgency;
// first-timers get a gentle nudge. Codes are honored manually at billing —
// there is no automated coupon system yet, so Sales HQ sees every code shown.
export async function decideExitOffer(visitorId: string, productKey: string | null, sectionsSeen: string[]): Promise<ExitOffer> {
  const session = await db.query.visitorSessions.findFirst({ where: eq(visitorSessions.visitorId, visitorId) })
  const visits = session?.visitCount ?? 1
  const sawPricing = sectionsSeen.includes("pricing")

  let offer: ExitOffer
  if (visits >= 2) {
    offer = {
      code: "VERI20BACK",
      headline: "Welcome back — this one's for you",
      body: "20% off your first year, because second looks deserve first-class treatment. Open your account now and the discount is locked in.",
      discountPct: 20,
      validHours: 48,
    }
  } else if (sawPricing) {
    offer = {
      code: "VERI15NOW",
      headline: "Before you go — 15% off, today only",
      body: "You've seen the pricing. Start today and take 15% off your first year — the system is live in minutes, and the discount goes with you.",
      discountPct: 15,
      validHours: 24,
    }
  } else {
    offer = {
      code: "VERI10HELLO",
      headline: "One more minute — it's worth it",
      body: "Open a free account and see your AI assistant work on your own data. Convert within a week and take 10% off your first year with this code.",
      discountPct: 10,
      validHours: 168,
    }
  }

  await db.insert(visitorEvents).values({
    visitorId,
    eventType: "offer_shown",
    page: productKey ? `/${productKey}` : "/",
    productKey: productKey && VALID_PRODUCTS.has(productKey) ? productKey : null,
    metadata: { code: offer.code, discountPct: offer.discountPct, visits, sawPricing },
  })
  return offer
}

// --- Sales HQ read side -------------------------------------------------------

export async function getVisitorFunnelStats(days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const [totals] = await db.select({
    visitors: sql<number>`count(distinct ${visitorEvents.visitorId})`,
    pageViews: sql<number>`count(*) filter (where ${visitorEvents.eventType} = 'page_view')`,
    ctaClicks: sql<number>`count(*) filter (where ${visitorEvents.eventType} = 'cta_click')`,
    offersShown: sql<number>`count(*) filter (where ${visitorEvents.eventType} = 'offer_shown')`,
    offersClicked: sql<number>`count(*) filter (where ${visitorEvents.eventType} = 'offer_clicked')`,
    signups: sql<number>`count(*) filter (where ${visitorEvents.eventType} = 'signup_completed')`,
  }).from(visitorEvents).where(gte(visitorEvents.createdAt, since))

  const byProduct = await db.select({
    productKey: visitorEvents.productKey,
    views: sql<number>`count(*) filter (where ${visitorEvents.eventType} = 'page_view')`,
    visitors: sql<number>`count(distinct ${visitorEvents.visitorId})`,
  }).from(visitorEvents)
    .where(and(gte(visitorEvents.createdAt, since), sql`${visitorEvents.productKey} is not null`))
    .groupBy(visitorEvents.productKey)
    .orderBy(desc(sql`count(*)`))

  // Where do people stop? The last section_view before an exit event is the
  // drop-off point — aggregated per section per product.
  const dropOffs = await db.execute(sql`
    with last_sections as (
      select distinct on (e.visitor_id, e.page)
        e.visitor_id, e.page, e.product_key, e.section
      from compliance.visitor_events e
      where e.event_type = 'section_view' and e.created_at >= ${since}
      order by e.visitor_id, e.page, e.created_at desc
    )
    select coalesce(product_key, 'cognitive') as product_key, section, count(*)::int as stopped_here
    from last_sections
    where section is not null
    group by product_key, section
    order by stopped_here desc
    limit 12
  `)

  return { totals, byProduct, dropOffs: (dropOffs as unknown as { rows?: unknown[] }).rows ?? dropOffs }
}

type FunnelAnalysis = { summary: string; biggestLeak: string; recommendations: string[] }

// On-demand VERIDIAN SALES AI analysis — real cognition over the real funnel,
// through the platform's own Layer 1 (task_oa) resolution. Runs only when a
// Sales HQ admin asks; the result is logged to orchestra_executions like
// every other AI execution on this platform.
export async function analyzeFunnelWithAI(ctx: { orgId: string; userId: string }) {
  const stats = await getVisitorFunnelStats(30)
  const modelConfig = await resolvePlatformModelConfig("task_oa")
  if (!modelConfig) throw new Error("No platform model configured for task_oa")

  const systemPrompt = await resolvePromptTemplate("sales_ai.funnel_analysis")

  const started = Date.now()
  const { data, usage } = await callLLMJson<FunnelAnalysis>(
    modelConfig.provider, modelConfig.model, modelConfig.apiKey,
    systemPrompt, JSON.stringify(stats),
    { temperature: 0.4, maxTokens: 700, expectedKeys: ["summary", "biggestLeak", "recommendations"] },
    modelConfig.fallback
  )
  recordOrchestraExecution({
    orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "sales_ai.funnel_analysis",
    input: { days: 30 }, output: { biggestLeak: data.biggestLeak },
    status: "completed", durationMs: Date.now() - started,
    provider: modelConfig.provider, model: modelConfig.model, usage,
  })
  return { analysis: data, stats }
}
