import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { z } from "zod";

const schema = z.object({ prompt: z.string().min(10).max(2000) });

const SYSTEM_PROMPT = `You are a compliance advisory assistant for Indian businesses.
Given a business description, suggest 6-10 specific compliance requirements the business must fulfill.
Return ONLY a JSON array of strings, each string being one compliance requirement.
Examples: "GST Monthly Returns (GSTR-1, GSTR-3B)", "TDS Quarterly Returns (Form 26Q)", "Shop & Establishment License"
Do not include any explanation, only the array.`;

export const POST = withAuth(async (req, ctx) => {
  const { prompt } = schema.parse(await req.json());

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    // Fallback to static suggestions when no API key is configured
    return NextResponse.json({
      suggestions: getStaticSuggestions(prompt),
      source: "static",
      generated_for: ctx.orgId,
    });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[AI generate] Anthropic error:", response.status, errText);
      return NextResponse.json({
        suggestions: getStaticSuggestions(prompt),
        source: "static_fallback",
        error: "AI service unavailable",
        generated_for: ctx.orgId,
      });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "[]";

    // Parse the JSON array from the response
    let suggestions: string[];
    try {
      // Extract array from potential markdown code blocks
      const match = text.match(/\[[\s\S]*\]/);
      suggestions = match ? JSON.parse(match[0]) : JSON.parse(text);
    } catch {
      suggestions = getStaticSuggestions(prompt);
    }

    return NextResponse.json({
      suggestions: Array.isArray(suggestions) ? suggestions.slice(0, 15) : getStaticSuggestions(prompt),
      source: "claude",
      generated_for: ctx.orgId,
    });
  } catch (error) {
    console.error("[AI generate] Error:", error);
    return NextResponse.json({
      suggestions: getStaticSuggestions(prompt),
      source: "static_fallback",
      error: "AI service error",
      generated_for: ctx.orgId,
    });
  }
});

/* ------------------------------------------------------------------
 * Static fallback — used when ANTHROPIC_API_KEY is not set or the
 * API call fails. Keyword-based matching for common industries.
 * ------------------------------------------------------------------ */

function getStaticSuggestions(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  if (lower.includes("manufactur") || lower.includes("factory")) {
    return [
      "GST Monthly Returns (GSTR-1, GSTR-3B)",
      "Factory Act License Renewal",
      "Pollution Control Board Consent (CTO/CTE)",
      "TDS Quarterly Returns (Form 26Q)",
      "Provident Fund Monthly Contributions",
      "ESIC Half-Yearly Returns",
      "CLRA Registration (if 10+ contract workers)",
      "Custom Duty Compliance (if importing)",
      "Labour Welfare Fund Annual Payment",
      "Professional Tax Registration",
    ];
  }
  if (lower.includes("it") || lower.includes("software") || lower.includes("tech") || lower.includes("saas")) {
    return [
      "GST Monthly Returns (GSTR-1, GSTR-3B)",
      "TDS on Salaries (Form 24Q)",
      "Income Tax Advance Tax (Quarterly)",
      "ROC Annual Returns (MGT-7/AOC-4)",
      "Provident Fund Monthly Contributions",
      "ESIC Half-Yearly Returns",
      "Professional Tax Registration",
      "Shop & Establishment License",
      "GST Annual Return (GSTR-9)",
      "Transfer Pricing Documentation (if applicable)",
    ];
  }
  if (lower.includes("ca") || lower.includes("accountant") || lower.includes("audit")) {
    return [
      "Peer Review Compliance (ICAI)",
      "GST Audit (GSTR-9C)",
      "Tax Audit (Form 3CB/3CD)",
      "Professional Tax Registration",
      "ROC Annual Returns for Own Firm",
      "SOP Compliance (Standard on Quality Control)",
      "Continuing Professional Education (CPE)",
      "Data Protection & Client Confidentiality",
    ];
  }
  // Default
  return [
    "GST Monthly Returns (GSTR-1, GSTR-3B)",
    "Income Tax Filing (ITR)",
    "TDS Quarterly Returns",
    "Provident Fund Monthly Contributions",
    "ESIC Half-Yearly Returns",
    "ROC Annual Returns (MGT-7/AOC-4)",
    "Professional Tax Registration",
    "Shop & Establishment License",
  ];
}