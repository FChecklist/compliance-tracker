-- The first-party monitoring tables (Cloudflare D1 database "dpdp-telemetry", free plan).
-- functions/api/_telemetry.ts creates the same tables on first use (CREATE ... IF NOT EXISTS), so this
-- file is the reference copy and the way to create them by hand:
--   wrangler d1 execute dpdp-telemetry --remote --file=data/telemetry.sql
-- There is deliberately NO column for an IP address, a user agent, a cookie or a query string.
CREATE TABLE IF NOT EXISTS telemetry (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, path TEXT, name TEXT, value REAL, detail TEXT, device TEXT, country TEXT);
CREATE INDEX IF NOT EXISTS telemetry_ts ON telemetry (ts, kind);
CREATE TABLE IF NOT EXISTS telemetry_budget (day TEXT PRIMARY KEY, n INTEGER NOT NULL);
