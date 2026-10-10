// PROJEXA-BUILD-001 U-46 step 1 (BR-581): the tests of scripts/gen-ai-link-registry.ts live at src/scripts/gen-ai-link-registry.test.ts.
// bunfig.toml sets the test root to src/, and a test file outside src/ is skipped by `bun test` and by CI. This one-line file only lets
// the file be run by its own path: bun test --isolate ./scripts/gen-ai-link-registry.test.ts
// The register row's command, `bun test --isolate scripts/gen-ai-link-registry.test.ts`, finds the file under src/ by its path.
import "../src/scripts/gen-ai-link-registry.test"
