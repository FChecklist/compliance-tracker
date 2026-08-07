import { NextResponse } from "next/server"
import { generateCaptcha } from "@/lib/forge-captcha"

// Public, unauthenticated -- issues a fresh math-captcha challenge for the
// FORGE intake form. No state stored server-side; the token itself carries
// what's needed to verify the answer at submit time.
//
// Edge Function Utilization gap-closure (Cloud Deployment / Deployment
// Operations review): generateCaptcha() is pure and DB-free (see
// forge-captcha.ts's header), and this is a public lead-capture-form
// challenge issued on page load -- exactly the low-latency, no-DB shape
// edge runtime is for.
export const runtime = 'edge'

export async function GET() {
  return NextResponse.json(generateCaptcha())
}
