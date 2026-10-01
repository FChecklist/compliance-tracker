// Types for facts.mjs (the loader for data/veridian-facts.yaml,
// data/claims-register.yaml and data/proof.yaml).

export interface KeyDate {
  date: string
  label: string
  what: string
}

export interface FactPage {
  name: string
  /** Optional per-page meta description / og:description; the one line is used when absent. */
  description?: string
  summary: string
  audience: string
}

export interface PartnerSection {
  h2: string
  paragraphs?: string[]
  steps?: string[]
  bullets?: string[]
}

export interface SalesPartner {
  owner_approved: boolean
  source: string
  nav_label: string
  button: string
  lead: string
  sign_in_note: string
  terms_link_text: string
  sections: PartnerSection[]
}

export interface SalesPartnerTerms {
  owner_approved: boolean
  source: string
  version: string
  effective_on: string
  heading: string
  status_line: string
  lead: string
  back_link_text: string
  sections: PartnerSection[]
}

export interface AiAssistant {
  owner_approved: boolean
  source: string
  nav_label: string
  button: string
  heading: string
  tagline: string
  home_line: string
  home_more: string
  lead: string
  sign_in_note: string
  sections: PartnerSection[]
}

export interface Facts {
  version: 2
  owner_approved: true
  approved_on: string
  approved_by: string
  product: string
  site: string
  company_site: string
  one_line: string
  fact_block_title: string
  who_for_line: string
  /** Exactly two lines, shown as an ordered list 1. 2. */
  who_for: [string, string]
  /** Exactly four lines, shown as a numbered list 1-4 under the home h1. */
  three_things: [string, string, string]
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
  contact: { owner_approved: boolean; address_approved_on: string; source: string; contact_email: string; subject_topics: string[] }
  ai_work_link_public_sentence: string
  sales_partner: SalesPartner
  sales_partner_terms: SalesPartnerTerms
  ai_assistant: AiAssistant
  pages: Record<string, FactPage> & { owner_approved: boolean }
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
export function loadFacts(): Facts
export function pageTitle(facts: Facts, path: string): string
export function pageDescription(facts: Facts, path: string): string
export function subjectTopicsClause(facts: Facts): string
export function contactSentence(facts: Facts): string
export function grievanceOfficerLine(facts: Facts): string
export function loadClaims(): ClaimsRegister
export function loadProof(): Proof
