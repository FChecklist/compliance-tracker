// R63 (2026-08-29): direct test harness for runL2Batch() -- bypasses the
// HTTP layer entirely (the /api/internal/*/run route family 404s in local
// dev for a reason not yet root-caused, tracked separately) to test the
// real L2 nightly-batch logic: gap_log clustering -> AI provider.analyse()
// -> phrase_map candidate / report_definition writes.
import { config } from "dotenv";
config({ path: ".env.local" });

const { runL2Batch } = await import("../src/lib/ai/batch/analyse.ts");

const result = await runL2Batch();
console.log(JSON.stringify(result, null, 2));
