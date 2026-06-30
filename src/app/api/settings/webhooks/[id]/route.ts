import { db, webhooks, users } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

const VALID_EVENTS = [
  "item.created",
  "item.completed",
  "item.overdue",
  "notice.received",
  "challan.recorded",
];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, user } = await requireAuth();
  if (response) return response;
  try {
    const { id } = await params;

    const userRecord = await db.query.users.findFirst({
      where: eq(users.email, user!.email!),
    });
    if (!userRecord?.orgId) {
      return NextResponse.json({ error: "No organisation found" }, { status: 400 });
    }

    const existing = await db.query.webhooks.findFirst({
      where: and(eq(webhooks.id, id), eq(webhooks.orgId, userRecord.orgId)),
    });
    if (!existing) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.name !== undefined) {
      const trimmed = body.name?.trim();
      if (!trimmed) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
      updates.name = trimmed;
    }
    if (body.url !== undefined) {
      const trimmed = body.url?.trim();
      if (trimmed && !trimmed.startsWith("https://")) {
        return NextResponse.json({ error: "URL must use HTTPS" }, { status: 400 });
      }
      updates.url = trimmed || existing.url;
    }
    if (body.events !== undefined) {
      const arr = Array.isArray(body.events) ? body.events : body.events.split(",");
      const validEvents = arr.filter((e: string) => VALID_EVENTS.includes(e.trim()));
      if (validEvents.length === 0) {
        return NextResponse.json({ error: "At least one valid event is required" }, { status: 400 });
      }
      updates.events = validEvents.join(",");
    }
    if (body.isActive !== undefined) {
      updates.isActive = Boolean(body.isActive);
    }

    const [updated] = await db
      .update(webhooks)
      .set(updates)
      .where(eq(webhooks.id, id))
      .returning();

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      url: updated.url,
      events: updated.events,
      isActive: updated.isActive,
      lastDeliveryAt: updated.lastDeliveryAt?.toISOString() ?? null,
      lastStatusCode: updated.lastStatusCode,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Webhook update error:", error);
    return NextResponse.json({ error: "Failed to update webhook" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, user } = await requireAuth();
  if (response) return response;
  try {
    const { id } = await params;

    const userRecord = await db.query.users.findFirst({
      where: eq(users.email, user!.email!),
    });
    if (!userRecord?.orgId) {
      return NextResponse.json({ error: "No organisation found" }, { status: 400 });
    }

    const existing = await db.query.webhooks.findFirst({
      where: and(eq(webhooks.id, id), eq(webhooks.orgId, userRecord.orgId)),
    });
    if (!existing) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }

    // Delete deliveries first
    await db.delete(db.schema.webhookDeliveries).where(
      eq(db.schema.webhookDeliveries.webhookId, id)
    );
    await db.delete(webhooks).where(eq(webhooks.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Webhook delete error:", error);
    return NextResponse.json({ error: "Failed to delete webhook" }, { status: 500 });
  }
}