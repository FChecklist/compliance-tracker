// VERIDIAN_Architecture_v2.0 phase_5_browser_execution_tiers -- barrel for
// the tiered Browser Execution Engine. Safe to import from a "use client"
// component: every module here (and its own transitive imports) is
// browser-safe by construction -- see engine.ts's header comment for the
// one deliberate exception (this barrel does NOT re-export anything from
// "@/lib/prompt-compiler"'s own barrel, which is NOT browser-safe; engine.ts
// imports only the specific submodules it needs directly).
export * from "./types"
export * from "./tier-capabilities"
export * from "./model-selection"
export * from "./tier-runners"
export * from "./storage-cache"
export * from "./sync-queue"
export * from "./function-tools"
export * from "./engine"
