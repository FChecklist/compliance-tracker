import { webhooks, webhookDeliveries } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
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
  const { response, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 });

  try {
    const { id } = await params;
    const body = await request.json();

    const result = await withTenantContext({ orgId }, async (db) => {
      const existing = await db.query.webhooks.findFirst({ where: eq(webhooks.id, id) });
      if (!existing) return null;

      const updates: Record<string, unknown> = { updatedAt: new Date() };

      if (body.name !== undefined) {
        const trimmed = body.name?.trim();
        if (!trimmed) return { error: "Name cannot be empty", status: 400 as const };
        updates.name = trimmed;
      }
      if (body.url !== undefined) {
        const trimmed = body.url?.trim();
        if (trimmed && !trimmed.startsWith("https://")) {
          return { error: "URL must use HTTPS", status: 400 as const };
        }
        updates.url = trimmed || existing.url;
      }
      if (body.events !== undefined) {
        const arr = Array.isArray(body.events) ? body.events : body.events.split(",");
        const validEvents = arr.filter((e: string) => VALID_EVENTS.includes(e.trim()));
        if (validEvents.length === 0) {
          return { error: "At least one valid event is required", status: 400 as const };
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

      return { updated };
    });

    if (!result) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    const { updated } = result;

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
  const { response, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 });

  try {
    const { id } = await params;

    const result = await withTenantContext({ orgId }, async (db) => {
      const existing = await db.query.webhooks.findFirst({ where: eq(webhooks.id, id) });
      if (!existing) return false;

      // Delete deliveries first (was previously referencing db.schema.webhookDeliveries,
      // a property that doesn't exist on the Drizzle client -- pre-existing typo, fixed here).
      await db.delete(webhookDeliveries).where(eq(webhookDeliveries.webhookId, id));
      await db.delete(webhooks).where(eq(webhooks.id, id));

      return true;
    });

    if (!result) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Webhook delete error:", error);
    return NextResponse.json({ error: "Failed to delete webhook" }, { status: 500 });
  }
}
