import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // For demo, get notifications for the admin user
    const adminUser = await db.user.findFirst({ where: { role: "admin" } });
    if (!adminUser) {
      return NextResponse.json({ notifications: [], unreadCount: 0 });
    }

    const notifications = await db.notification.findMany({
      where: { userId: adminUser.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const unreadCount = await db.notification.count({
      where: { userId: adminUser.id, isRead: false },
    });

    return NextResponse.json({
      notifications: notifications.map((n) => ({
        id: n.id,
        title: n.title,
        message: n.message,
        type: n.type,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount,
    });
  } catch (error) {
    console.error("Notifications API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 }
    );
  }
}