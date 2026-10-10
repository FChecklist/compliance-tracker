// PROJEXA-BUILD-001 U-18 / U-19 (register rows BR-210, BR-213, BR-288): the one
// rule for "may this caller touch that project". A credential is either
// org-wide (a VERIDIAN chat link, an org_service API key: projectId null) or
// pinned to one project (a PROJEXA work link, a project_ai API key). Pure, no
// I/O, so every surface that enforces a scope -- the MCP link route, the
// pipeline's run functions, the API-key routes -- asks the same question the
// same way.

export type ProjectScope = { projectId: string | null }

export type ProjectScopeCheck = { ok: true } | { ok: false; status: 403; message: string }

export const PROJECT_OUT_OF_SCOPE_MESSAGE = 'This credential is limited to one project and cannot act on another.'

function named(projectId: string | null | undefined): string | null {
  return typeof projectId === 'string' && projectId.trim().length > 0 ? projectId : null
}

/**
 * A scope with a projectId allows a request that names that same project, or
 * names none (the caller then runs it on the scope's project -- it never
 * falls back to org-wide). A scope with projectId null allows anything, which
 * is every org-wide credential's behaviour before U-18.
 */
export function assertProjectInScope(scope: ProjectScope, requestedProjectId: string | null | undefined): ProjectScopeCheck {
  const pinned = named(scope.projectId)
  if (pinned === null) return { ok: true }
  const requested = named(requestedProjectId)
  if (requested === null || requested === pinned) return { ok: true }
  return { ok: false, status: 403, message: PROJECT_OUT_OF_SCOPE_MESSAGE }
}
