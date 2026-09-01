// Simple math captcha for the FORGE intake form -- deliberately not a hard
// security boundary (this is a lead-capture form, not an auth flow), just a
// low-friction filter against casual scripted spam. Pure functions, no DB
// dependency, so /api/forge/captcha can issue a challenge without touching
// anything that needs a live database connection.
//
// Uses the standard Web btoa()/atob() (not Node's Buffer) so this stays
// edge-runtime-safe -- Buffer is a Node global that isn't guaranteed to
// exist on Vercel's Edge Runtime, while btoa/atob are the Web-standard
// base64 primitives available in both Node 18+ and Edge. Payload is
// always plain ASCII digits + ":", so no Unicode-safe encoding is needed.
export function generateCaptcha(): { question: string; token: string } {
  const a = 1 + Math.floor(Math.random() * 9)
  const b = 1 + Math.floor(Math.random() * 9)
  const token = btoa(`${a}:${b}`)
  return { question: `What is ${a} + ${b}?`, token }
}

export function verifyCaptcha(token: string, answer: number): boolean {
  try {
    const [a, b] = atob(token).split(":").map(Number)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false
    return a + b === answer
  } catch {
    return false
  }
}
