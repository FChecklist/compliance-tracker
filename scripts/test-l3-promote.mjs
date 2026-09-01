// R63 (2026-08-29): direct test harness for L3 (promotePhraseMapCandidate)
// -- the real-human-approval step that turns an L2-proposed phrase_map
// candidate into a live L0 match. Pure DB logic, no AI provider involved.
import { config } from "dotenv";
config({ path: ".env.local" });

const { promotePhraseMapCandidate } = await import("../src/lib/ai/batch/analyse.ts");

const orgId = process.argv[2];
const candidateId = process.argv[3];
const promotedById = process.argv[4];
if (!orgId || !candidateId || !promotedById) {
  throw new Error("usage: bun scripts/test-l3-promote.mjs <orgId> <phrase_map id> <promotedById>");
}

const result = await promotePhraseMapCandidate(orgId, candidateId, promotedById);
console.log(JSON.stringify(result, null, 2));
