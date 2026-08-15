import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    // eslint-plugin-react-hooks v7's new React Compiler rule -- flags the
    // standard "fetch in useEffect, setState when the async load() resolves"
    // pattern used by virtually every page in this app (confirmed via a
    // minimal repro: even a single useState+single fetch+single setState
    // trips it), so enforcing it as an error would require rewriting every
    // existing data-fetching page. Matches the same rationale as the two
    // rules above it.
    "react-hooks/set-state-in-effect": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",

    // Code Complexity Score (VERIDIAN Review Framework, AI Engineering
    // Quality / Technical Debt & Complexity finding, 2026-07-18): the repo
    // had no measured complexity metric, only line-count as a size proxy.
    // Cyclomatic complexity (branches/loops/case arms per function) is a
    // more direct signal of "hard to safely refactor" than raw size --
    // task-execution-engine.ts (2437 lines) is large AND has real branch
    // sprawl; a 500-line CRUD service file is large but usually flat.
    // "warn" (not "error") deliberately: this repo's largest orchestration
    // files (task-execution-engine.ts, report-engine-service.ts,
    // capability-tree-service.ts, chat-service.ts, ai-team/roster.ts) were
    // written before this rule existed and will show real violations on
    // first run -- flipping straight to "error" would fail CI on pre-
    // existing code with zero warning period, the same trap
    // check-guardrail-presence.mjs's own comments warn against elsewhere in
    // this repo. `bun run lint` (eslint . with no --max-warnings flag) does
    // not fail the build on warnings, so this is measurement-first: it
    // makes complexity visible in `bun run lint` output today without
    // blocking anyone, and gives Refactoring Readiness (the paired finding
    // below) a real ranked list of *why* a file is risky to touch, not just
    // how long it is. Threshold 20 is eslint's own long-standing default
    // recommendation, not repo-specific tuning.
    "complexity": ["warn", 20],
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "public/litert-spike/wasm/**", "public/litert-spike-embeddings/wasm/**"]
}];

export default eslintConfig;
