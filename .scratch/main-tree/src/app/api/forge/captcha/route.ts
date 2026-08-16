import { NextResponse } from "next/server"
import { generateCaptcha } from "@/lib/forge-captcha"

// Public, unauthenticated -- issues a fresh math-captcha challenge for the
// FORGE intake form. No state stored server-side; the token itself carries
// what's needed to verify the answer at submit time.
export async function GET() {
  return NextResponse.json(generateCaptcha())
}
