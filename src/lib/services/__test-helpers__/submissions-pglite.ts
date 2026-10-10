// PROJEXA-BUILD-002 WP-13/WP-15: the compliance.submissions table (and its two enums) for the PGlite tests of way 5, whose proposals are
// submissions rows. The columns are those the proposal store and the approval read and write; the real table has more, all nullable.
export const SUBMISSIONS_SQL = `
CREATE TYPE compliance.submission_status AS ENUM ('chat', 'in_progress', 'done', 'partial', 'failed');
CREATE TYPE compliance.submission_classification AS ENUM ('CHAT_ONLY', 'TASK', 'MULTIPLE_TASKS');
CREATE TABLE compliance.submissions (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  project_id text,
  mode text NOT NULL,
  selected_chain jsonb,
  raw_input text NOT NULL,
  user_id text NOT NULL,
  status compliance.submission_status DEFAULT 'in_progress' NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  classification compliance.submission_classification,
  level smallint,
  source text,
  l0_hit_rate numeric(5,4),
  model_calls integer,
  cache_hits integer,
  level1_outcome text,
  level1_refusal_code text,
  via text,
  ai_link_id text
);`
