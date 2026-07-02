import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next") ?? "/dashboard"

  if (code) {
    // Reuses the same createClient() as every other server-side auth call
    // (lib/supabase/server.ts) -- previously this imported a `createClient`
    // that @supabase/ssr doesn't actually export (only createServerClient/
    // createBrowserClient), so every magic-link/OAuth callback threw here.
    // Its own cookies.setAll was also a no-op ("middleware will handle
    // this"), which wouldn't have persisted the session even if the import
    // hadn't crashed first -- Route Handlers can write cookies via
    // next/headers' cookies(), which is exactly what the shared helper does.
    const supabase = await createClient()

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