// Types for facts.mjs (the loader for data/veridian-facts.yaml,
// data/claims-register.yaml and data/proof.yaml).

export interface KeyDate {
  date: string
  label: string
  what: string
}

export interface FactPage {
  name: string
  summary: string
  audience: string
}

export interface Facts {
  version: 1
  owner_approved: true
  approved_on: string
  approved_by: string
  product: string
  site: string
  company_site: string
  one_line: string
  who_for_line: string
  who_for: string[]
  what_it_does: string
  three_strongest_facts: [string, string, string]
  deadline_line: string
  what_it_does_not_do: string
  about_this_system: string[]
  brand: { full: string; short: string; share_ask: string; share_url: string; title_prefix: string }
  brand_line: string
  key_dates: { owner_approved: boolean; source: string; items: KeyDate[] }
  library: { owner_approved: boolean; source: string; version: string; file: string; reviewer: string | null; reviewed_on: string | null; owner_required: boolean; job_count: number }
  storage: {
    owner_approved: boolean
    verified_on: string
    database: { country: string; city: string; provider: string; region: string; sentence: string; source: string }
    email: { provider: string; provider_country: string; sentence: string; source: string }
    website: { provider: string; sentence: string; source: string }
    stored_in_india_wording: string
  }
  company: { owner_approved: boolean; owner_required: boolean; source: string; legal_name: string | null; cin: string | null; registered_office: string | null; gstin: string | null; incorporation: string }
  contact: { owner_approved: boolean; source: string; grievance_officer_email: string; partners_email: string }
  ai_work_link_public_sentence: string
  pages: Record<string, FactPage> & { owner_approved: boolean }
  public_fields: string[]
  proof: { enabled: boolean; content: string }
}

export interface FactException {
  sentence: string
  words: string[]
  kind: string
  why: string
}

export interface Claim {
  id: string
  sentence: string
  words: string[]
  where?: string
  evidence: string
  owner_approved: boolean
  approved_on?: string
  legal_approved: boolean
}

export interface ClaimsRegister {
  version: 1
  banned_words: string[]
  fact_exceptions: FactException[]
  claims: Claim[]
}

export interface Proof {
  title: string
  intro: string
  aggregates: { owner_required: boolean; as_of: string | null; items: Array<{ label: string; value: number | null }> }
  case_studies: { owner_required: boolean; items: Array<{ organisation: string; consent_on: string; summary: string }> }
  library_reviewer: { owner_required: boolean }
}

export const APP_DIR: string
export const DATA_DIR: string
export const FACTS_FILE: string
export const CLAIMS_FILE: string
export const PROOF_FILE: string
export const FACT_PAGE_PATHS: string[]
export function getPath(obj: unknown, path: string): unknown
export function loadFacts(): Facts
export function publicFacts(facts: Facts): Record<string, unknown>
export function pageTitle(facts: Facts, path: string): string
export function loadClaims(): ClaimsRegister
export function loadProof(): Proof
