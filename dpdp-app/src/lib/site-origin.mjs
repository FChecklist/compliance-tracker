// The static host's own origin (WO-DPDP-012 §0). Its own tiny,
// dependency-free module on purpose: src/lib/api.ts (the /app/ browser
// bundle) needs only this one constant, and importing it from
// public-surface.mjs pulled in facts.mjs's Node-only fileURLToPath/
// readFileSync/join into the browser bundle -- a WO-DPDP-013 Part 2
// regression that crashed every /app/ page load with "(0 , Te.fileURLToPath)
// is not a function" (facts.mjs's top-level APP_DIR computation, externalized
// by Vite for the browser and then actually called at runtime).
export const SITE_ORIGIN = "https://app.veridian-aios.com"
