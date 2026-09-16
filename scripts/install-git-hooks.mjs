// Points git at .githooks/ so the checked-in pre-commit secret scan actually
// runs. Runs from "prepare" (bun/npm install) -- fails open (never blocks
// install) because it only matters in a real git checkout with write access
// to local git config, neither of which every CI/sandbox context has.
import { execSync } from "node:child_process"

try {
  execSync("git config core.hooksPath .githooks", { stdio: "ignore" })
} catch {
  // Not a git repo, or git unavailable -- nothing to wire up.
}
