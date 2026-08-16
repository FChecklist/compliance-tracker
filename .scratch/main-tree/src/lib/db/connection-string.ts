// Gap closure, 2026-07-09 (AUDIT_2026-07-09.md, Performance Bottlenecks
// section). This exact connection-string-resolution logic used to be
// copy-pasted independently into 3 files (db/index.ts, lib/embeddings.ts,
// lib/ai-config-crypto.ts) -- when Wave 45 root-caused and fixed the
// wrong-pooler-region bug (aws-0-ap-northeast-2, the deleted MeetTrack
// project's region, instead of this project's real aws-1-ap-south-1) and
// Wave 103 propagated that fix, it was applied file-by-file rather than to
// one shared function -- ai-config-crypto.ts's copy was missed and still had
// the wrong region as of this audit (dormant only because DATABASE_URL
// stays set in Vercel; the fallback only fires when it's unset). A 4th copy
// drifting the same way is now impossible by construction.
export function getConnectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const dbPassword = process.env.SUPABASE_DB_PASSWORD
  if (supabaseUrl && dbPassword) {
    const ref = supabaseUrl.replace("https://", "").split(".")[0]
    return `postgresql://postgres.${ref}:${dbPassword}@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`
  }

  throw new Error("No database connection string available. Set DATABASE_URL or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_DB_PASSWORD.")
}
