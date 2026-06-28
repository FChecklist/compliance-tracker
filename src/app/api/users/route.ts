import { db, users } from "@/lib/db";
import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";

export async function GET() {
  try {
    const allUsers = await db.query.users.findMany({
      with: { department: { columns: { name: true } } },
      orderBy: asc(users.name),
    })

    return NextResponse.json({
      users: allUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        department: u.department ? { name: u.department.name } : null,
        createdAt: u.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error("Users API error:", error)
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 })
  }
}
