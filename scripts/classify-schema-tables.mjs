#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure, 2026-08-15 (Architecture & Design /
// Reusability Across Scope, finding "Module Reusability Across Industries" --
// "Core domain modeling is still CA-firm/compliance-first, not truly
// industry-neutral. Recommended: document which of the [then-]416 tables
// are compliance-specific vs universal").
//
// Parses src/lib/db/schema.ts directly (the single source of truth --
// CLAUDE.md: "hundreds of tables as of 2026-07-14; growing every wave --
// do not cite a specific count, check schema.ts directly") and classifies
// every `complianceSchemaDB.table(...)` definition into one of three
// buckets:
//
//   - universal        -- generic business/platform capability any org in
//                          any industry would use (auth, orgs, CRM, generic
//                          PMS, generic ERP accounting/inventory, chat,
//                          AI orchestration, facilities mgmt, HR, training,
//                          ticketing, connectors, gamification...).
//   - compliance        -- CA-firm / Indian-regulatory-compliance domain
//                          specific (GST/TDS/MCA/SEBI/RBI/IRDAI, POSH,
//                          secretarial, board governance mandated by the
//                          Companies Act, litigation, the CA-firm-practice-
//                          management "firm_*" tables, statutory payroll).
//   - industry_vertical -- built for a SPECIFIC non-compliance industry
//                          vertical (construction/interior design, i.e.
//                          PROJEXA) -- itself live, working evidence this
//                          codebase already reuses its platform core across
//                          more than one industry, which is the finding's
//                          own ask.
//
// Classification is table-name-first (prefix/keyword rules below), falling
// back to the nearest preceding `// ─── Section ───` comment in schema.ts
// only when the table name itself is not conclusive -- several schema.ts
// sections are grab-bag "Wave NN" headers spanning tables from more than
// one domain (e.g. "Wave 86" alone covers fm_*, firm_*, sales_*, esignature_*,
// llm_response_cache, visitor_*, connector_* -- a single section-level
// classification for that header would misclassify most of its rows), so
// name-based rules are checked first and are what carries most of the
// weight here.
//
// This is a plain static-analysis report -- no DB access, no live query --
// and is meant to be re-run whenever schema.ts grows (per CLAUDE.md, every
// wave), not a one-time snapshot:
//   node scripts/classify-schema-tables.mjs > docs/TABLE_REUSABILITY_CLASSIFICATION.md
//
// Honest limitation, same class as this repo's other coverage scripts
// (check-guardrail-presence.mjs etc.): the RULES array below is a manually
// curated judgment call, not a formally verifiable oracle -- a new table
// that doesn't match any rule falls through to the section-header fallback,
// and if even that doesn't match, it's reported under "uncategorized" so a
// gap in the rules is visible rather than silently mis-bucketed.

import { readFileSync } from 'node:fs'

const SCHEMA_PATH = 'src/lib/db/schema.ts'

// ─── Name-based rules (checked in order, first match wins) ────────────────
// Each rule: { test: (tableName) => boolean, category, note }
const RULES = [
  // --- Industry vertical: PROJEXA (construction / interior design) ---
  { test: n => n.startsWith('construction_'), category: 'industry_vertical', note: 'PROJEXA construction domain (BOQ, site diary, RFIs, submittals, punch list, change orders)' },
  { test: n => n.startsWith('interior_'), category: 'industry_vertical', note: 'PROJEXA interior-design domain (mood boards, FF&E, floor plans, materials)' },

  // --- Compliance / CA-firm / Indian regulatory domain ---
  { test: n => n.startsWith('gst_'), category: 'compliance', note: 'India GST verification/reconciliation engine' },
  { test: n => n.startsWith('firm_'), category: 'compliance', note: 'CA-firm practice management (client service lines, engagements, tax cases, billable staff time) -- literally the CA-firm vertical' },
  { test: n => n.startsWith('posh_'), category: 'compliance', note: 'India POSH (workplace harassment) statutory committee/complaints' },
  { test: n => ['mca_filings', 'secretarial_audits', 'cap_table_entries', 'cap_table_events', 'company_charges'].includes(n), category: 'compliance', note: 'India Companies Act company-secretarial filings' },
  { test: n => ['sebi_compliance_items', 'rbi_compliance_items', 'irdai_compliance_items'].includes(n), category: 'compliance', note: 'India sector-regulator (SEBI/RBI/IRDAI) compliance tracking' },
  { test: n => ['board_meetings', 'board_action_items', 'committees', 'related_party_transactions', 'delegation_of_authority', 'directors_kmp', 'board_evaluations'].includes(n), category: 'compliance', note: 'Companies Act board-governance mandates (independent directors, RPT disclosure, DoA) -- not a generic "meetings" feature' },
  { test: n => n === 'policies' || n === 'approval_requests', category: 'universal', note: 'generic document/attestation and approval-request tracking (category/requestType/entityType are free-text, no India-specific fields) -- lives under the GOVERNANCE schema.ts section but is itself industry-neutral' },
  { test: n => ['hr_compliance_items', 'leave_policy_entries', 'holiday_list_filings'].includes(n), category: 'compliance', note: 'statutory HR compliance filings (distinct from the generic leave_requests/employee_profiles HR module)' },
  { test: n => n.startsWith('erp_salary_') || n.startsWith('erp_income_tax_') || n.startsWith('erp_tax_withholding_') || n === 'erp_statutory_rules', category: 'compliance', note: 'India statutory payroll (PF/ESI/Professional Tax/TDS slabs) -- country-specific tax law, not generic payroll' },
  { test: n => ['litigation_matters', 'legal_arbitration_cases', 'whistleblower_cases'].includes(n), category: 'compliance', note: 'statutory/regulatory dispute and integrity-reporting obligations' },
  { test: n => ['compliance_items', 'challans', 'notices', 'notice_dispatches', 'audit_points', 'compliance_costs', 'cost_payments', 'compliance_frameworks', 'framework_controls', 'audit_engagements', 'audit_findings'].includes(n), category: 'compliance', note: 'the original core compliance-tracking domain this product was built around' },
  { test: n => ['risks', 'bcm_plans', 'bcm_business_impact_analyses', 'bcm_recovery_procedures', 'bcm_exercises', 'it_dr_plans', 'it_dr_backup_verifications', 'it_dr_failover_tests', 'incidents'].includes(n), category: 'compliance', note: 'GRC risk/BCM/IT-DR programs -- regulatory-driven, not a generic-business need' },
  { test: n => ['vendor_risk_profiles', 'esg_metrics', 'fraud_cases', 'mdm_duplicate_candidates', 'mdm_merge_log', 'contract_compliance_items', 'access_review_cycles', 'access_review_certifications'].includes(n), category: 'compliance', note: 'third-party/ESG/fraud/access-review GRC controls' },

  // --- Universal / platform (generic business capability, any industry) ---
  { test: n => n.startsWith('erp_'), category: 'universal', note: 'generic accounting/inventory/procurement/sales ERP -- every business needs invoicing, purchase orders, and stock, regardless of industry (statutory-payroll subset carved out above into compliance)' },
  { test: n => n.startsWith('pms_') || n === 'org_product_branch_enablements' || n === 'knowledge_base_pages' || n === 'automation_rules' || n === 'automation_rule_runs', category: 'universal', note: 'generic project/issue-tracking (Jira/Linear-shaped), not compliance- or industry-specific' },
  { test: n => n.startsWith('crm_'), category: 'universal', note: 'generic CRM (leads, opportunities, accounts, contacts)' },
  { test: n => n.startsWith('fm_'), category: 'universal', note: 'generic facilities management (assets, PPM schedules, AMC contracts, visitor log) -- applicable to any physical-premises business' },
  { test: n => n.startsWith('training_'), category: 'universal', note: 'generic LMS (courses, assessments, enrollments)' },
  { test: n => n.startsWith('sales_'), category: 'universal', note: 'generic sales-partner/referral/commission tracking' },
  { test: n => n.startsWith('veri_reward_'), category: 'universal', note: 'generic gamification/refer-and-earn' },
  { test: n => n.startsWith('clm_') || n.startsWith('esignature_'), category: 'universal', note: 'generic contract-lifecycle-management / e-signature' },
  { test: n => ['employee_profiles', 'leave_requests', 'leave_balances', 'hr_attendance_records', 'hr_holidays', 'job_openings', 'candidates', 'job_applications', 'interview_feedback', 'performance_review_cycles', 'performance_reviews'].includes(n), category: 'universal', note: 'generic HR/ATS/performance-review -- no compliance regime attached' },
  { test: n => ['tickets', 'installed_products', 'ticket_satisfaction_surveys', 'field_service_dispatches', 'problem_records', 'problem_tickets', 'ticket_intelligence_items', 'ticket_intelligence_action_items'].includes(n), category: 'universal', note: 'generic customer-service/ticketing (ITIL-shaped)' },
  { test: n => n.startsWith('connector_') || n === 'forge_project_requests' || n === 'contact_submissions' || n.startsWith('visitor_'), category: 'universal', note: 'generic integration/website-lead capture, product-agnostic' },
  { test: n => n === 'llm_response_cache', category: 'universal', note: 'generic infra cache' },
  { test: n => n.startsWith('gst_') === false && (n.includes('conversation') || n.includes('message') || n === 'message_attachments'), category: 'universal', note: 'generic chat' },
  { test: n => n.startsWith('veri_meeting') || n === 'veri_meetings', category: 'universal', note: 'generic minutes-of-meeting capture, not tied to any regulatory meeting type' },
  { test: n => n.startsWith('voice_memo'), category: 'universal', note: 'generic voice-to-ticket capture' },
  { test: n => n.startsWith('sso_'), category: 'universal', note: 'generic platform auth (SAML SSO)' },
  { test: n => n === 'token_usage_ledger' || n === 'computation_engines', category: 'universal', note: 'internal platform cost/engine metering, product-agnostic' },
  { test: n => ['organisations', 'branches', 'clients', 'client_entities', 'user_client_access', 'subscription_plans', 'departments', 'users', 'stage0_sources', 'documents', 'document_correspondents', 'document_matching_rules', 'comments', 'notifications', 'audit_logs', 'api_keys', 'api_key_request_log', 'platform_applications', 'org_invite_links', 'org_join_codes', 'user_active_sessions', 'org_join_code_attempts', 'passcode_login_attempts', 'webhooks', 'webhook_deliveries', 'ai_configurations', 'embeddings', 'entity_relationships', 'embedding_cache', 'mcp_access_codes', 'onboarding_steps'].includes(n), category: 'universal', note: 'core multi-tenant platform primitives (auth, org hierarchy, docs, notifications, audit log, API keys, webhooks, embeddings) -- every tenant of every industry needs these' },
  { test: n => n.startsWith('ai_') || n.startsWith('assistant_') || n.startsWith('worker_agent') || n.startsWith('task') || n.startsWith('orchestra_') || n.startsWith('prompt_cache') || n === 'tool_health_events' || n === 'activity_log' || n === 'ai_agent_directory' || n === 'agent_review_records' || n === 'dynamic_chains' || n === 'approval_preferences' || n === 'scoped_delegations' || n.endsWith('_model_config') || n === 'shared_pool_allocations' || n.startsWith('module_') || n.startsWith('prompt_') || n.startsWith('loop_') || n === 'knowledge_flow_log' || n === 'data_separation_audit' || n === 'ingestion_batches' || n === 'ingestion_items' || n === 'products' || n === 'projects' || n === 'code_change_requests' || n.startsWith('approval_workflow_') || n.startsWith('report_') || n === 'saved_reports' || n === 'report_schedules' || n === 'custom_charts' || n === 'metric_alert_rules' || n === 'fde_requests' || n.startsWith('monitor_') || n === 'workspace_memory_capsule_events' || n.startsWith('audit_protocol_'), category: 'universal', note: 'AI orchestration / task / agent / self-improvement / workflow-engine platform layer -- infrastructure, not a business domain at all' },
  { test: n => n === 'conversation_share_links' || n === 'conversation_guest_access' || n === 'conversation_participants', category: 'universal', note: 'generic chat sharing/guest-access' },
  { test: n => n === 'product_branches' || n === 'product_branch_modules', category: 'universal', note: 'multi-product/multi-brand platform enablement (which product-branch, e.g. VERIDIAN vs PROJEXA, has which module on) -- infrastructure for cross-industry reuse itself' },
  { test: n => n === 'instruction_commitments' || n === 'instruction_mismatch_detections', category: 'universal', note: 'generic AI-chat instruction-tracking (detects an assistant reply that contradicts a prior commitment) -- not tied to any business domain' },
  // The 10 tables below sit under schema.ts's "Construction Intelligence
  // (Wave 120)" comment purely because that's where they were added
  // chronologically -- none of them are construction-domain tables. Listed
  // explicitly so the section-header fallback (which would otherwise
  // wrongly bucket them as industry_vertical) never reaches them.
  { test: n => n === 'application_errors' || n === 'deployment_events', category: 'universal', note: 'generic app-error/deployment observability logging' },
  { test: n => n === 'doc_processing_jobs' || n === 'email_intelligence_items' || n === 'email_intelligence_action_items' || n === 'drafted_communications', category: 'universal', note: 'generic document/email AI processing pipeline, industry-agnostic' },
  { test: n => n === 'platform_assets' || n === 'asset_registration_config', category: 'universal', note: 'the UMR/asset-registry meta-system that tracks this codebase\'s own source-code assets -- platform tooling, not a business domain' },
  { test: n => n === 'instruction_packages' || n === 'capability_improvement_proposals', category: 'universal', note: 'AI task-capability/self-improvement platform layer, product-agnostic' },
]

function classify(name, section) {
  for (const rule of RULES) {
    if (rule.test(name)) return { category: rule.category, note: rule.note, via: 'name' }
  }
  // Section-header fallback for anything a name rule didn't catch.
  const s = section.toLowerCase()
  if (s.includes('governance') || s.includes('legal') || s.includes('secretarial') || s.includes('sector regulators') || s.includes('audit —') || s.includes('third-party') || s.includes('integrity') || s.includes('incidents') || s.includes('people & hr') || s.includes('risk')) {
    return { category: 'compliance', note: `section fallback: "${section}"`, via: 'section' }
  }
  if (s.includes('construction') || s.includes('projexa')) {
    return { category: 'industry_vertical', note: `section fallback: "${section}"`, via: 'section' }
  }
  return { category: 'uncategorized', note: `no rule matched; section was "${section}"`, via: 'none' }
}

function extractTables(src) {
  const lines = src.split('\n')
  let section = '(preamble)'
  const rows = []
  const sectionRe = /^\/\/\s*───+\s*(.*?)\s*───+/
  const tableRe = /^export const (\w+) = complianceSchemaDB\.table\('([a-zA-Z0-9_]+)'/
  for (const line of lines) {
    const secMatch = line.match(sectionRe)
    if (secMatch) { section = secMatch[1].trim(); continue }
    const tabMatch = line.match(tableRe)
    if (tabMatch) rows.push({ varName: tabMatch[1], tableName: tabMatch[2], section })
  }
  return rows
}

function main() {
  const src = readFileSync(SCHEMA_PATH, 'utf8')
  const tables = extractTables(src)
  const classified = tables.map(t => ({ ...t, ...classify(t.tableName, t.section) }))

  const byCategory = { universal: [], compliance: [], industry_vertical: [], uncategorized: [] }
  for (const row of classified) byCategory[row.category].push(row)

  const total = classified.length
  const pct = n => total ? ((n / total) * 100).toFixed(1) : '0.0'

  const CATEGORY_LABEL = {
    universal: 'Universal / Platform (industry-neutral)',
    compliance: 'Compliance-specific (CA-firm / Indian regulatory domain)',
    industry_vertical: 'Industry-vertical (built for a specific non-compliance industry -- currently construction/interior design, i.e. PROJEXA)',
    uncategorized: 'Uncategorized (rule gap -- needs a classification rule added)',
  }

  let out = ''
  out += `# Table Reusability Classification: Compliance-Specific vs Universal\n\n`
  out += `**Generated by:** \`scripts/classify-schema-tables.mjs\` (static analysis of \`src/lib/db/schema.ts\` -- no DB access). Re-run after any wave that adds tables:\n\n`
  out += '```\nnode scripts/classify-schema-tables.mjs > docs/TABLE_REUSABILITY_CLASSIFICATION.md\n```\n\n'
  out += `**Context:** VERIDIAN Review Framework gap-closure, "Module Reusability Across Industries" finding -- "Core domain modeling is still CA-firm/compliance-first, not truly industry-neutral." This document answers that directly: of the **${total}** tables currently in \`compliance.*\` (schema.ts), **${byCategory.universal.length} (${pct(byCategory.universal.length)}%)** are industry-neutral platform/business primitives usable by any organization, **${byCategory.compliance.length} (${pct(byCategory.compliance.length)}%)** are CA-firm / Indian-regulatory-compliance specific (the domain this product was originally built around), and **${byCategory.industry_vertical.length} (${pct(byCategory.industry_vertical.length)}%)** are built for a second, distinct industry vertical (construction/interior design, shipped as PROJEXA) -- itself live evidence the platform core already generalizes across industries rather than staying single-purpose.\n\n`
  out += `The \`compliance\` schema namespace name predates this multi-industry reality (it was the original product name/scope) and is a Postgres schema identifier, not an architectural claim -- renaming it is a real breaking-change/migration undertaking out of scope for this Low-severity documentation finding; noted here as a known naming-legacy artifact, not hidden.\n\n`
  out += `## Summary\n\n`
  out += `| Category | Tables | Share |\n|---|---:|---:|\n`
  for (const cat of ['universal', 'compliance', 'industry_vertical', 'uncategorized']) {
    out += `| ${CATEGORY_LABEL[cat]} | ${byCategory[cat].length} | ${pct(byCategory[cat].length)}% |\n`
  }
  out += `| **Total** | **${total}** | 100.0% |\n\n`

  for (const cat of ['universal', 'compliance', 'industry_vertical', 'uncategorized']) {
    const rows = byCategory[cat]
    if (rows.length === 0) continue
    out += `## ${CATEGORY_LABEL[cat]} (${rows.length})\n\n`
    out += `| Table | Rationale |\n|---|---|\n`
    // Group consecutive identical notes to keep the table readable given
    // several hundred rows share one rationale (e.g. all erp_* tables).
    for (const row of rows) {
      out += `| \`${row.tableName}\` | ${row.note} |\n`
    }
    out += '\n'
  }

  process.stdout.write(out)
}

main()
