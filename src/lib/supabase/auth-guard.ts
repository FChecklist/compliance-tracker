import { NextResponse } from "next/server"
import { createClient } from "./server"

export async function requireAuth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { user: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  return { user, response: null }
}
