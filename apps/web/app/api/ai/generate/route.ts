import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { z } from "zod";

const schema = z.object({ prompt: z.string().min(10).max(1000) });

const COMPLIANCE_SUGGESTIONS: Record<string,string[]> = {
  it: ["GST Monthly Returns (GSTR-1, GSTR-3B)","TDS Quarterly Returns","Income Tax Advance Tax","ROC Annual Returns","PF Monthly Contributions","ESIC Monthly Contributions"],
  manufacturing: ["Factory Act License Renewal","Pollution Control Board Consent","GST Returns","Custom Duty Compliance","Labour Welfare Fund","CLRA Registration"],
  default: ["GST Returns","Income Tax Filing","TDS Compliance","PF & ESIC","ROC Filings","Professional Tax"],
};

export const POST = withAuth(async (req, ctx) => {
  const { prompt } = schema.parse(await req.json());
  const lower = prompt.toLowerCase();
  const suggestions = lower.includes("manufactur") ? COMPLIANCE_SUGGESTIONS.manufacturing
    : lower.includes("it") || lower.includes("software") || lower.includes("tech") ? COMPLIANCE_SUGGESTIONS.it
    : COMPLIANCE_SUGGESTIONS.default;
  return NextResponse.json({ suggestions, generated_for: ctx.orgId });
});