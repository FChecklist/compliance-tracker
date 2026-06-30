import { db, users } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  try {
    const allUsers = await db.query.users.findMany({
      with: { department: { columns: { name: true } } },
      orderBy: asc(users.name),
      where: orgId ? eq(users.orgId, orgId) : undefined,
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

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!dbUser || (dbUser.role !== 'admin' && dbUser.role !== 'manager')) {
    return NextResponse.json({ error: "Only admins and managers can invite users" }, { status: 403 })
  }
  try {
    const { name, email, role } = await request.json()
    if (!name || !email) return NextResponse.json({ error: "Name and email are required" }, { status: 400 })
    const VALID_ROLES = ['admin', 'manager', 'member', 'viewer'] as const
    const userRole = (VALID_ROLES as readonly string[]).includes(role) ? role : 'member'

    const existing = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase().trim()) })
    if (existing) return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 })

    // Create auth user via Supabase Admin API and send invite email
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email.toLowerCase().trim(), {
      data: { name, orgId, role: userRole },
    })
    if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

    // Create user record in compliance.users
    const [newUser] = await db.insert(users).values({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      role: userRole as typeof VALID_ROLES[number],
      orgId: orgId ?? undefined,
      isActive: false, // becomes active after they accept invite
    }).returning()

    return NextResponse.json({ id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role }, { status: 201 })
  } catch (error) {
    console.error("User invite error:", error)
    return NextResponse.json({ error: "Failed to invite user" }, { status: 500 })
  }
}
