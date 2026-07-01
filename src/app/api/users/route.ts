import { db, users, aiAssistants } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ users: [] })

  try {
    const allUsers = await withTenantContext({ orgId }, (db) =>
      db.query.users.findMany({
        with: { department: { columns: { name: true } } },
        orderBy: asc(users.name),
      })
    )

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
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { name, email, role } = await request.json()
    if (!name || !email) return NextResponse.json({ error: "Name and email are required" }, { status: 400 })
    const VALID_ROLES = ['admin', 'manager', 'member', 'viewer'] as const
    const userRole = (VALID_ROLES as readonly string[]).includes(role) ? role : 'member'

    // Email is globally unique (mirrors the auth.users constraint) -- this
    // check is intentionally NOT tenant-scoped, unlike everything else here.
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

    // compliance.users.passwordHash is legacy from before this app used
    // Supabase Auth exclusively -- nothing reads it for real authentication
    // anymore (login goes through supabase.auth.signInWithPassword), but the
    // column is still NOT NULL. Fill it with an unusable random hash rather
    // than leave it out, which would throw a NOT NULL violation on insert.
    const placeholderPasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10)

    // Create user record in compliance.users, scoped to the inviter's org
    const [newUser] = await withTenantContext({ orgId }, (db) =>
      db.insert(users).values({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        passwordHash: placeholderPasswordHash,
        role: userRole as typeof VALID_ROLES[number],
        authUserId: authData?.user?.id,
        orgId,
        isActive: false, // becomes active after they accept invite
      }).returning()
    )

    // Wave 2: provision 5 AI Assistants for the invitee. Uses the raw
    // (RLS-bypassing) db client deliberately -- ai_assistants RLS requires
    // current_user_id() to equal the row's user_id, and the inviting admin's
    // tenant context has no reason to carry the invitee's user id. This
    // mirrors autoProvisionUser's rationale in auth-guard.ts.
    await db.insert(aiAssistants).values(
      Array.from({ length: 5 }, (_, i) => ({
        userId: newUser.id,
        assistantNumber: i + 1,
        label: `Assistant ${i + 1}`,
      }))
    )

    return NextResponse.json({ id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role }, { status: 201 })
  } catch (error) {
    console.error("User invite error:", error)
    return NextResponse.json({ error: "Failed to invite user" }, { status: 500 })
  }
}
