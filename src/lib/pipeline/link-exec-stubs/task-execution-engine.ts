// Stub of src/lib/task-execution-engine.ts for the ai-work-link-exec bundle: the read-only dispatch engine (mathjs, model calls). Its functions are
// reads, not link writes, and the exec function only runs a function the claim SQL put on the link's effective write list.
import { thrower } from "./unavailable"
export const dispatchTool = thrower("the task execution engine (dispatchTool)")
export const executeTask = thrower("the task execution engine (executeTask)")
