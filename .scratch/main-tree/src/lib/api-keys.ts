// Shared API-key helpers -- used by both the Settings > API Keys generation
// route (src/app/api/settings/api-keys/route.ts) and the incoming-request
// validator (src/lib/supabase/api-key-auth.ts), so the hashing algorithm
// can never drift between the side that mints a key and the side that
// checks one.

export async function hashSHA256(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

export function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let random = ""
  for (let i = 0; i < 32; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return `vk_${random}`
}
