// R53 Phase 7 -- emits the phrase_map seed as SQL.
//
// The SQL applied to the database is GENERATED FROM the same
// src/lib/pipeline/phrase-seed.ts catalogue the code reads, so what is in
// compliance.phrase_map provably equals what the code says should be there.
// Hand-writing the INSERT separately is how the two drift.
//
// Usage: bun scripts/emit-phrase-map-seed.ts <orgId> [<orgId> ...]
import { seedPhrases } from "../src/lib/pipeline/phrase-seed";

const orgs = process.argv.slice(2);
if (orgs.length === 0) {
  console.error("usage: bun scripts/emit-phrase-map-seed.ts <orgId> [<orgId> ...]");
  process.exit(1);
}

const rows = seedPhrases();
const values: string[] = [];
for (const org of orgs) {
  for (const r of rows) values.push(`('${org}','${r.phrase.replace(/'/g, "''")}','${r.functionId}')`);
}

// promoted_at is set because Level 0 only ever matches a PROMOTED phrase
// (M26: "Level 3 approves phrase-map promotions"). This seed IS a Level 3
// act -- authored on the build side, reviewed in a PR, never proposed by a
// model. An unpromoted seed would leave Level 0 exactly as dead as it was.
console.log(`-- R53 Phase 7 phrase_map seed: ${rows.length} phrases x ${orgs.length} org(s) = ${values.length} rows`);
console.log(`INSERT INTO compliance.phrase_map (id, org_id, normalised_phrase, function_id, hit_count, promoted_by_id, promoted_at)
SELECT 'r53seed_' || substr(md5(v.org_id || ':' || v.phrase), 1, 20), v.org_id, v.phrase, v.function_id, 0, 'R53', now()
FROM (VALUES
${values.join(",\n")}
) AS v(org_id, phrase, function_id)
ON CONFLICT (org_id, normalised_phrase) DO NOTHING;`);
