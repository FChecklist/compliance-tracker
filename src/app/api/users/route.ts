import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const users = await db.user.findMany({
      include: {
        department: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        department: u.department ? { name: u.department.name } : null,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Users API error:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}