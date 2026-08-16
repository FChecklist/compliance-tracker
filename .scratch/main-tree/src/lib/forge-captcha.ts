// Simple math captcha for the FORGE intake form -- deliberately not a hard
// security boundary (this is a lead-capture form, not an auth flow), just a
// low-friction filter against casual scripted spam. Pure functions, no DB
// dependency, so /api/forge/captcha can issue a challenge without touching
// anything that needs a live database connection.
export function generateCaptcha(): { question: string; token: string } {
  const a = 1 + Math.floor(Math.random() * 9)
  const b = 1 + Math.floor(Math.random() * 9)
  const token = Buffer.from(`${a}:${b}`).toString("base64")
  return { question: `What is ${a} + ${b}?`, token }
}

export function verifyCaptcha(token: string, answer: number): boolean {
  try {
    const [a, b] = Buffer.from(token, "base64").toString("utf-8").split(":").map(Number)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false
    return a + b === answer
  } catch {
    return false
  }
}
