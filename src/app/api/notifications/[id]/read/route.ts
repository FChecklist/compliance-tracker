import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    const notification = await db.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      return NextResponse.json(
        { error: "Notification not found" },
        { status: 404 }
      );
    }

    await db.notification.update({
      where: { id },
      data: { isRead: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Notification read API error:", error);
    return NextResponse.json(
      { error: "Failed to mark notification as read" },
      { status: 500 }
    );
  }
}