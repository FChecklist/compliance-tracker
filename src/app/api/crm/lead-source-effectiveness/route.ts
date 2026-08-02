import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getLeadSourceEffectivenessReport, ServiceError } from "@/lib/services/crm-service"

// sap_reports gap analysis, lead_source_effectiveness (BUILD_NEW). Per that
// analysis: conversion_rate and avg_deal_size_by_source only -- CAC is
// omitted entirely, not fabricated, since this schema has no marketing-spend-
// by-source table today.
export async function GET(_request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ bySource: [] })

  try {
    const result = await getLeadSourceEffectivenessReport({ orgId })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM lead-source-effectiveness error:", error)
    return NextResponse.json({ error: "Failed to fetch lead source effectiveness report" }, { status: 500 })
  }
}
