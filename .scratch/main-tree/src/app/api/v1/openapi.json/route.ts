import { NextResponse } from "next/server"
import { generateOpenApiDocument } from "@/lib/openapi/generate"

// Public by design -- an API spec describing the contract shape isn't
// sensitive, and a ChatGPT custom GPT Action / integration tool needs to
// fetch this before it has a customer's key to authenticate anything else.
export async function GET() {
  return NextResponse.json(generateOpenApiDocument())
}
