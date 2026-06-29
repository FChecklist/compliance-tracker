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

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}