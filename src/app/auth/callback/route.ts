import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next") ?? "/dashboard"

  if (code) {
    const { createClient } = await import("@supabase/ssr")
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            // Parse cookies from the request
            const cookieHeader = request.headers.get("cookie") ?? ""
            return cookieHeader.split(";").map((c) => {
              const [name, ...rest] = c.trim().split("=")
              return { name: name.trim(), value: rest.join("=") }
            })
          },
          setAll(cookiesToSet) {
            // We can't set cookies from a route handler directly
            // The middleware will handle this
          },
          remove(cookiesToRemove) {
            // Handled by middleware
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Link this Supabase Auth identity to a pre-seeded compliance.users row
      // by email, if one exists and isn't linked yet. Real self-service org
      // provisioning on signup doesn't exist yet (tracked separately in
      // orchestra_changes.md) -- this only covers users an admin already
      // seeded, logging in for the first time.
      const authUser = data?.user
      if (authUser?.email) {
        try {
          const { db, users } = await import("@/lib/db")
          const { eq, and, isNull } = await import("drizzle-orm")
          await db
            .update(users)
            .set({ authUserId: authUser.id })
            .where(and(eq(users.email, authUser.email), isNull(users.authUserId)))
        } catch (linkError) {
          console.error("Failed to link auth_user_id on callback:", linkError)
        }
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}