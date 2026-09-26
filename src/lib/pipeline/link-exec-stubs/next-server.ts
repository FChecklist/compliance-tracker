// Stub of next/server for the ai-work-link-exec bundle (scripts/awl-exec-aliases.mjs). The closure uses only `after`, to run a fire-and-forget
// automation-rule trigger once the response is sent. The exec function has no response to wait for and a link write skips that trigger (PMD-45
// R-E), so `after` here runs nothing and returns.
export function after(_task: unknown): void {
  // skipped on purpose: see the header
}
