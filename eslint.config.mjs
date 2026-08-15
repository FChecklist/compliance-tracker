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
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "public/litert-spike/wasm/**", "public/litert-spike-embeddings/wasm/**"]
}, {
  // AI Engineering Quality / Technical Debt gap-closure -- "Code
  // Complexity Score" finding: no measured complexity score existed
  // anywhere, only file-size as a rough proxy. Cyclomatic complexity via
  // ESLint's built-in `complexity` rule is a real measured score; this
  // starts it on the largest true orchestration/business-logic files in
  // src/lib (picked by `git ls-files | xargs wc -l`, excluding
  // src/lib/db/schema.ts -- a declarative table-definition file, not
  // orchestration logic that complexity scoring is meaningful for) rather
  // than repo-wide, per the finding's own recommended approach.
  //
  // Threshold was set from a real measurement, not guessed: running
  // `bun run lint` with this rule at threshold 1 against these 7 files
  // measured a max cyclomatic complexity of 22 (generateAiReply in
  // chat-service.ts -- re-measured 2026-08-15 after merging ~900 commits
  // of upstream drift; an initial pre-merge measurement the same day had
  // found 18, confirming this file grew genuinely, not a fluke), with the
  // next-highest at 18 (buildGstReconciliationNodes in
  // erp-fixed-assets-service.ts). `error` at 23 is a ratchet -- locks in
  // "no new function in these files exceeds today's worst measured
  // complexity" as a real CI gate, without retroactively forcing an
  // unplanned refactor of those functions today. Functions already above
  // ~10-11 here (there are several) are the natural next refactor
  // candidates for the "Refactoring Readiness" finding this same PR
  // addresses -- tighten this threshold in a future PR as they're brought
  // down, rather than ratcheting it down all at once.
  //
  // Deliberately not repo-wide yet: this codebase's src/app/**/page.tsx
  // files and other services were never measured for this, and setting a
  // blanket threshold without measuring first would be exactly the kind of
  // decorative gate this finding was raised against. Expand this list in a
  // future PR once these files are refactored under it and the pattern is
  // proven, not before.
  files: [
    "src/lib/services/report-engine-service.ts",
    "src/lib/services/capability-tree-service.ts",
    "src/lib/services/chat-service.ts",
    "src/lib/services/erp-fixed-assets-service.ts",
    "src/lib/services/capability-audit-service.ts",
    "src/lib/orchestra-model-resolver.ts",
    "src/lib/task-tightening.ts",
  ],
  rules: {
    complexity: ["error", 23],
  },
}, {
  // task-execution-engine.ts is the single largest orchestration file
  // (2400+ lines) and was measured alongside the 7 files above -- but its 3
  // largest functions (dispatchEngine: complexity 398, a giant
  // engine-type switch statement; dispatchTool: 123; executeTask: 50) are
  // so far past any reasonable threshold that gating them at the same
  // `error, 23` as the 7 files above would either instantly fail CI on any
  // unrelated PR, or force setting the threshold so high (>= 372) that it
  // becomes decorative -- exactly the kind of toothless gate this finding
  // was raised against.
  //
  // Kept as `warn` (visible in `bun run lint` output, does not fail CI)
  // rather than silently left unmeasured: this is the clearest, most
  // concrete "Refactoring Readiness" candidate this PR's own scan
  // surfaced, but refactoring a 2437-line core task-dispatch engine blind,
  // in the same PR that adds the measurement tooling, is a materially
  // bigger and riskier change than this gap-closure's scope -- left for a
  // dedicated, reviewed follow-up PR instead of an unplanned same-PR
  // rewrite of the task dispatcher.
  files: ["src/lib/task-execution-engine.ts"],
  rules: {
    complexity: ["warn", 23],
  },
}];

export default eslintConfig;
