// PROJEXA-BUILD-002 WP-03 -- the "shell project" convention.
//
// A shell is the placeholder project the "New project with my AI" flow creates so an AI holding a
// link has a project to fill. It is a real project row, made by createProject(); the only thing
// that marks it is the pair below, which needs no schema change:
//   - its name is SHELL_PROJECT_NAME, and
//   - its status is 'planning' (an existing pms_project_status value), not 'active'.
// The AI's first update_project renames it, and a renamed project is no longer a shell, so the
// marker never outlives the setup.
//
// WHY A MARKER AT ALL. The exceptions detectors (construction-exceptions-service.ts) are anti-joins
// over real rows, so an empty project yields no flagged item today (proven by
// project-shell.test.ts). The marker is what a future detector, a picker or a report reads to leave
// a not-yet-filled placeholder out of its lists without guessing from emptiness.
export const SHELL_PROJECT_NAME = "New project (AI setup)"
export const SHELL_PROJECT_STATUS = "planning"

/** True while a project still carries both marks of a shell. */
export function isAiSetupShell(project: { name: string; status?: string | null }): boolean {
  return project.name === SHELL_PROJECT_NAME && project.status === SHELL_PROJECT_STATUS
}
