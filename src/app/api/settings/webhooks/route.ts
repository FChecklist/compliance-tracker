import { db, webhooks, webhookDeliveries, users } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

const VALID_EVENTS = [
  "item.created",
  "item.completed",
  "item.overdue",
  "notice.received",
  "challan.recorded",
];

function generateSecret(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 40; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `whsec_${result}`;
}

export async function GET() {
  const { response, user } = await requireAuth();
  if (response) return response;
  try {
    const userRecord = await db.query.users.findFirst({
      where: eq(users.email, user!.email!),
    });
    if (!userRecord?.orgId) {
      return NextResponse.json({ webhooks: [] });
    }

    const items = await db.query.webhooks.findMany({
      where: eq(webhooks.orgId, userRecord.orgId),
      orderBy: desc(webhooks.createdAt),
    });

    // For each webhook, get last 5 deliveries
    const results = await Promise.all(
      items.map(async (w) => {
        const deliveries = await db.query.webhookDeliveries.findMany({
          where: eq(webhookDeliveries.webhookId, w.id),
          orderBy: desc(webhookDeliveries.createdAt),
          limit: 5,
        });
        return {
          id: w.id,
          name: w.name,
          url: w.url,
          secret: w.secret,
          events: w.events,
          isActive: w.isActive,
          lastDeliveryAt: w.lastDeliveryAt?.toISOString() ?? null,
          lastStatusCode: w.lastStatusCode,
          createdAt: w.createdAt.toISOString(),
          recentDeliveries: deliveries.map((d) => ({
            id: d.id,
            eventType: d.eventType,
            statusCode: d.statusCode,
            success: d.success,
            attempt: d.attempt,
            createdAt: d.createdAt.toISOString(),
          })),
        };
      })
    );

    return NextResponse.json({ webhooks: results });
  } catch (error) {
    console.error("Webhooks list error:", error);
    return NextResponse.json({ error: "Failed to fetch webhooks" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { response, user } = await requireAuth();
  if (response) return response;
  try {
    const body = await request.json();
    const { name, url, events } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (!url || typeof url !== "string" || !url.trim().startsWith("https://")) {
      return NextResponse.json({ error: "Valid HTTPS URL is required" }, { status: 400 });
    }
    if (!events || !Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: "At least one event type is required" }, { status: 400 });
    }
    const validEvents = events.filter((e: string) => VALID_EVENTS.includes(e));
    if (validEvents.length === 0) {
      return NextResponse.json({ error: "No valid event types selected" }, { status: 400 });
    }

    const userRecord = await db.query.users.findFirst({
      where: eq(users.email, user!.email!),
    });
    if (!userRecord?.orgId) {
      return NextResponse.json({ error: "No organisation found" }, { status: 400 });
    }

    const secret = generateSecret();

    const [created] = await db.insert(webhooks).values({
      name: name.trim(),
      url: url.trim(),
      secret,
      events: validEvents.join(","),
      isActive: true,
      orgId: userRecord.orgId,
    }).returning();

    return NextResponse.json(
      {
        id: created.id,
        name: created.name,
        url: created.url,
        secret: created.secret,
        events: created.events,
        isActive: created.isActive,
        createdAt: created.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Webhook create error:", error);
    return NextResponse.json({ error: "Failed to create webhook" }, { status: 500 });
  }
}