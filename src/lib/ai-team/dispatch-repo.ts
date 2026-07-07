// Fires the `ai-team-task` repository_dispatch event (.github/workflows/
// ai-team-workforce.yml), which runs scripts/ai-workforce-agent.mjs against
// a fresh checkout and opens a PR. This is the repo-write path for AI
// Workforce roles -- runRole() in team-service.ts stays the advisory-only
// (no file access) path for guardrail checks and quick answers.
//
// Requires a GitHub PAT with repo-dispatch permission on this repo. Not
// currently set as a Vercel env var (only exists as the GitHub Actions
// secret PAT_FCHECKLIST) -- calling this from the deployed app will throw
// until GITHUB_DISPATCH_PAT is added to Vercel. Until then, trigger via
// `gh api repos/FChecklist/compliance-tracker/dispatches` directly.

import { getRole } from "./roster"

const REPO = "FChecklist/compliance-tracker"

export async function dispatchRepoTask(roleKey: string, task: string): Promise<void> {
  const role = getRole(roleKey)
  if (!role || role.isHuman || role.isCodeOnly || !role.model) {
    throw new Error(`Role '${roleKey}' is not a repo-write-capable AI Workforce role.`)
  }

  const token = process.env.GITHUB_DISPATCH_PAT
  if (!token) throw new Error("GITHUB_DISPATCH_PAT is not configured -- cannot fire repository_dispatch from the app.")

  const res = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: "ai-team-task", client_payload: { role_key: roleKey, task } }),
  })
  if (!res.ok) throw new Error(`Failed to dispatch ai-team-task: HTTP ${res.status} ${await res.text()}`)
}
