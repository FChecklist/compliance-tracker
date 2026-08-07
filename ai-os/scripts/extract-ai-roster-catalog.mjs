// Mechanical extraction of the AI Team roster via dynamic import of the
// real, evaluated roster.ts module -- not text-parsing the object literal,
// not AI-written. Reads AI_TEAM_ROSTER directly plus the helper functions'
// own outputs (guardrail roles, audit-org roles, escalation-level roles)
// so the catalog matches exactly what team-service.ts itself would see.
// Run: node extract-ai-roster-catalog.mjs /abs/path/to/roster.ts /abs/output.json
import path from 'path'

const rosterPath = process.argv[2]
const outputPath = process.argv[3]
if (!rosterPath || !outputPath) {
  console.error('Usage: extract-ai-roster-catalog.mjs /abs/path/to/roster.ts /abs/output.json')
  process.exit(1)
}
const mod = await import(rosterPath)

const roster = mod.AI_TEAM_ROSTER
if (!Array.isArray(roster)) {
  console.error('AI_TEAM_ROSTER export not found or not an array')
  process.exit(1)
}

const byTeam = {}
for (const role of roster) {
  byTeam[role.team] = (byTeam[role.team] || 0) + 1
}

const byModel = {}
for (const role of roster) {
  const key = role.model || (role.isCodeOnly ? '(code_only, no model)' : role.isHuman ? '(human, no model)' : '(null)')
  byModel[key] = (byModel[key] || 0) + 1
}

const guardrailRoles = typeof mod.allGuardrailRoles === 'function' ? mod.allGuardrailRoles().map(r => r.roleKey) : null
const auditOrgRoles = typeof mod.allAuditOrganizationRoles === 'function' ? mod.allAuditOrganizationRoles().map(r => r.roleKey) : null
const operational = typeof mod.operationalRoles === 'function' ? mod.operationalRoles().map(r => r.roleKey) : null

const result = {
  generated_by: 'extract-ai-roster-catalog.mjs (dynamic import of the real AI_TEAM_ROSTER export, not AI-written)',
  source_file: rosterPath,
  role_count: roster.length,
  by_team: byTeam,
  by_model: byModel,
  code_only_role_count: roster.filter(r => r.isCodeOnly).length,
  human_role_count: roster.filter(r => r.isHuman).length,
  llm_backed_role_count: roster.filter(r => r.model && !r.isCodeOnly && !r.isHuman).length,
  guardrail_role_keys: guardrailRoles,
  audit_organization_role_keys: auditOrgRoles,
  operational_role_keys: operational,
  roles: roster,
}

const fs = await import('fs')
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2))
console.log(JSON.stringify({
  role_count: roster.length,
  by_team: byTeam,
  code_only_role_count: result.code_only_role_count,
  human_role_count: result.human_role_count,
  llm_backed_role_count: result.llm_backed_role_count,
}, null, 2))
