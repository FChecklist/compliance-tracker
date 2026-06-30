# Veridian AI — Platform Vision & Feature Prioritisation
## Author: DEVABOSS (Claude Code) — Merged with Z.ai audit
## Perspective: AI-Native Compliance & Audit Operating System
## Last Updated: 2026-06-29

---

## The Reframe: What This Product Actually Is

**This is NOT a tax filing platform.**
This is a **Compliance & Audit Operating System** — the single source of truth for every compliance obligation a company has, which can ingest data from any tool, expose that data to any AI, and push outputs to any downstream system.

The distinction matters for every product and engineering decision:

| Tax Filing Platform | Compliance & Audit OS (what we are building) |
|---|---|
| Files returns on government portals | Tracks whether returns were filed, by whom, when, with what proof |
| Replaces your CA / Tally / GSTN portal | Works alongside your CA / Tally / GSTN portal |
| Owns the transaction | Owns the record, the evidence, and the accountability |
| Single workflow | Orchestrates across people, tools, and AI agents |
| Closed system | Open platform — data in, data out, AI pluggable |

The product's job: **know everything about your compliance state, make it available to humans and AI alike, and ensure nothing falls through the cracks.**

---

## The Four Architectural Principles

### 1. Data In — Ingest from Anywhere
Pull compliance data from: government portals (when APIs are available), Tally CSV exports, uploaded PDF documents (notices, certificates, challans), manual entry via web UI, and external systems via inbound API/webhooks.

### 2. Data Out — Export to Anything
Push compliance state to: customer's own AI (via API key), customer's CA firm's system (via shared access code), board reporting tools (via PDF/Excel export), customer's ERP (via outbound webhooks), and customer's custom GPT or AI agent (via MCP server interface).

### 3. AI-Native — Every Feature Has an AI Layer
Document upload → AI extracts structured data automatically. Notice received → AI identifies reply deadline and suggests action. Overdue item → AI drafts escalation email. Compliance history → AI generates board report. The AI is pluggable: customer uses their own OpenAI / Anthropic / Groq key (BYOK — Bring Your Own Key). Platform's own orchestration uses Groq's free open-source LLMs.

### 4. Near-Zero Operating Cost — Cloud-Native, AI-Assisted Operations
Every layer of the product lifecycle — development, deployment, customer support, AI, storage — is covered by free or near-free cloud tiers. The goal: the platform can serve the first 200 customers at under ₹5,000/month total infrastructure cost.

---

## Zero-Cost Infrastructure Architecture

The entire stack is designed so that cloud provider free tiers and BYOK AI keys eliminate ongoing costs until significant revenue is generated.

### Infrastructure Layer (Near-Zero Cost)

| Service | Purpose | Cost |
|---|---|---|
| **Supabase** (already live) | PostgreSQL + Auth + Storage + pgvector + Edge Functions | Free up to 500MB DB / 5GB storage. Pro = $25/month for production scale |
| **Vercel** (already live) | Next.js deployment + CDN + edge | Free tier — 100GB bandwidth, unlimited deployments |
| **GitHub Actions** (already live) | CI/CD pipeline | Free for public repos |
| **Groq Cloud** | Open-source LLM orchestration (Llama 3.3 70B, Mixtral, Gemma 2, DeepSeek R1) | Free tier: 6,000 req/day, 30 req/min — sufficient for first 200 customers |
| **Resend** | Transactional email (deadline reminders, notices) | Free: 100 emails/day. $20/month for 50K emails |
| **Cloudflare** | DNS, CDN, DDoS protection | Free tier covers all early-stage needs |
| **pgvector** (Supabase extension) | Vector embeddings for semantic search and RAG | Included in Supabase — $0 additional |
| **pdf-parse / Tesseract** (npm) | PDF text extraction for uploaded documents | Open-source — $0 |

**Total operating cost for first 200 customers: $25–50/month (Supabase Pro + Resend).**

### AI Layer (BYOK = $0 Platform Cost)

The platform never pays for AI API calls. Customers bring their own keys:

```
Customer Settings → AI Configuration
├── OpenAI API Key    → GPT-4o / ChatGPT for their work
├── Anthropic API Key → Claude for complex legal/tax analysis
├── Groq API Key      → Free Llama 3.3 70B for high volume tasks
└── Google AI Key     → Gemini for document understanding
```

Keys are stored encrypted in Supabase Vault. All AI API calls are routed through the customer's own key — billed to the customer's account, not the platform's. Platform AI cost = $0.

**Platform's own AI (for features like auto-extraction, health scoring, orchestration):** Uses Groq free tier (Llama 3.3 70B). Cost: $0.

### Customer Lifecycle Cost = $0 via AI

| Activity | Traditional Cost | AI-Native Cost |
|---|---|---|
| Customer onboarding | Human CSM call | AI onboarding assistant (Groq) guides setup |
| Support tickets | Human support agent | AI support bot trained on help docs (pgvector RAG) |
| Compliance Q&A | Human answers | AI answers from customer's own data |
| Board report generation | Human analyst | AI generates from structured data |
| Notice response drafting | CA firm billable hour | AI drafts, human reviews |
| Bug reports | Manual triage | AI classifies and routes |

---

## AI Architecture: The Orchestrator Model

```
┌─────────────────────────────────────────────────────────┐
│                  GROQ ORCHESTRATOR                       │
│           (Llama 3.3 70B — Free Tier)                   │
│  The "super boss" — routes tasks to the right agent     │
└────────────┬──────────────────────────────┬─────────────┘
             │                              │
    ┌────────▼────────┐          ┌──────────▼──────────┐
    │  DOCUMENT AGENT  │          │  COMPLIANCE AGENT    │
    │  Groq Vision /  │          │  Customer BYOK key   │
    │  pdf-parse      │          │  (Claude/GPT/Llama)  │
    │                 │          │                      │
    │  - Extract ARN  │          │  - Analyse notice    │
    │  - Parse notice │          │  - Draft reply       │
    │  - Read challan │          │  - Summarise status  │
    └────────┬────────┘          └──────────┬───────────┘
             │                              │
    ┌────────▼──────────────────────────────▼───────────┐
    │              pgvector DATABASE (Supabase)          │
    │  Embeddings of: documents + compliance items +    │
    │  Indian tax law (CBIC circulars, GST notifications│
    │  CBDT orders) + company's own compliance history  │
    └────────────────────────┬──────────────────────────┘
                             │
    ┌────────────────────────▼──────────────────────────┐
    │              OPEN API / ACCESS CODE               │
    │  Customer's ChatGPT Custom GPT can query this     │
    │  Customer's CA firm can pull client data          │
    │  Customer's ERP receives compliance webhooks      │
    │  Customer's MCP-compatible AI tool connects here  │
    └───────────────────────────────────────────────────┘
```

### What the Orchestrator Does

The Groq orchestrator agent (running on Groq's free API, Llama 3.3 70B) is the "brain" that:
1. Receives a trigger (new document uploaded / deadline approaching / notice logged)
2. Decides which sub-agent to invoke (document parser, compliance analyser, reminder drafter)
3. Passes the result to the appropriate next step (store in pgvector / notify user / update compliance item)
4. Logs all agent actions in the audit trail

This is a lightweight agentic loop — not a complex multi-agent framework. It runs as a Supabase Edge Function triggered by database events. Cost: $0 (Groq free tier + Supabase Edge Functions free tier).

---

## Data In — What the Platform Accepts

| Source | Method | What Gets Created |
|---|---|---|
| Manual entry (web UI) | Form submission | Compliance item |
| CSV/Excel upload | Bulk import | Multiple compliance items |
| PDF upload (notice, certificate, return acknowledgement) | AI extraction | Structured fields auto-populated (ARN, amount, deadline) |
| Tally CSV export | Parsed import | TDS and GST compliance items with amounts pre-filled |
| Inbound API (customer pushes data from their tool) | REST API + access code | Compliance item or notice or challan record |
| Inbound webhook (from customer's ERP or CA software) | Webhook endpoint | Auto-created compliance item |
| Email forward (customer forwards a government notice to a dedicated inbox) | Email parsing (Resend inbound) | Notice created in SCN register automatically |

---

## Data Out — What the Platform Exports

| Destination | Method | What Goes Out |
|---|---|---|
| Customer's ChatGPT / AI agent | API + access code or MCP server | Compliance status, items, documents, notice history |
| Customer's CA firm | Shared read-only access code | Client's full compliance dashboard (no coding needed) |
| Customer's ERP / Tally | Outbound webhook on status change | Compliance status updates, challan records |
| Board report | PDF export | Structured quarterly compliance report |
| Audit team | Excel export | Full compliance register with evidence links |
| Government portals | Manual (we do NOT file — we track) | N/A — user files on portal, pastes ARN back |
| Customer's custom script | REST API | Any compliance data in JSON |

---

## pgvector: What It Enables

Supabase supports pgvector natively — no additional service needed. This unlocks:

**1. Semantic search across all compliance data**
"Find all compliance items related to ITC mismatch" — returns relevant items even if they don't contain those exact words.

**2. Document RAG (Retrieval Augmented Generation)**
Customer uploads 3 years of GST notices. Asks: "Have we received any notice about interest on late payment for Maharashtra GSTIN?" The AI searches the vector index and returns the relevant notice with the exact paragraph highlighted.

**3. Indian tax law knowledge base**
Pre-load embeddings of: CBIC GST notifications, CBDT Income Tax circulars, MCA company law updates. When a customer asks "what is the penalty for late GSTR-9 filing?", the AI retrieves from this knowledge base — not from a hallucinated answer.

**4. Compliance pattern analysis**
"Which compliance types have the highest miss rate for companies in your industry?" — analysed from anonymised, aggregated vector data across all customers.

**5. AI onboarding assistant**
New user asks: "How do I set up GST compliance for my Pvt Ltd?" The AI retrieves the relevant help articles from pgvector and gives a contextual, specific answer.

---

## What Already Exists — Do Not Re-Build

Confirmed from schema + codebase + Z.ai audit:

| Feature | Status | Notes |
|---|---|---|
| Authentication | ✅ | Supabase Auth SSR — email + magic link |
| Organisation management | ✅ | GSTIN, PAN, CIN at entity level (Z.ai confirmed) |
| Departments + RBAC | ✅ | admin / manager / member / viewer |
| Task assignment | ✅ | assignedToId on items + audit points |
| Compliance items (10 Indian types) | ✅ | GST, TDS, MCA, PF, ESIC, Income Tax, ROC, Labour, Environmental, Other |
| Audit points (sub-tasks) | ✅ | Separate assignee, due date |
| Documents (basic) | ✅ | URL stored — Supabase Storage not yet wired |
| Comments | ✅ | Threaded per item |
| In-app notifications | ✅ | Deadline, assignment, status, comment, mention |
| Audit log | ✅ | Full action trail |
| Dashboard | ✅ | Totals, overdue, due-this-week, completion %, charts |
| Reports + CSV export | ✅ | Basic — needs enhancement |
| Penalty calculator | ✅ | Indian rates — GST, TDS, PF, MCA |
| Compliance list + search | ✅ | Basic filters |
| Settings | ✅ | Profile, org, notifications, preferences |
| Team management | ✅ | Invite, list |
| Global search | ✅ | Cmd+K |
| Dark mode | ✅ | Already built |
| Responsive design | ✅ | Tailwind |

**Schema gaps that block use today:** no period/FY field, no ARN/acknowledgement field, no challan table, no notice/SCN table, no location table, no recurrence engine, no approval workflow, no pgvector schema, no API key management table, no access code table.

---
---

# TIER 1 — MUST HAVE
### Without these, the platform cannot acquire or retain its first 50 paying customers.

---

### M-01: pgvector Schema + Document Embedding Pipeline
**What:** Enable the `pgvector` extension in Supabase (already supported, just needs to be activated). Add `embedding vector(1536)` column to compliance_items, documents, and a new `knowledge_base` table. When a document is uploaded or a compliance item is created, generate embeddings via Groq's embedding model (free) or OpenAI's `text-embedding-3-small` (customer BYOK). Store in pgvector.
**Why Must Have:** This is the foundational layer for every AI feature. Without it, the "AI-native" claim is hollow. Every other AI feature (document extraction, semantic search, RAG Q&A, AI onboarding) depends on this being in place first. It is also a near-zero-cost infrastructure addition — pgvector runs inside the existing Supabase instance.
**Minimum scope:** Activate pgvector extension in Supabase. `embeddings` table with: entity_type, entity_id, embedding vector(1536), content_hash. Background job (Supabase Edge Function) to generate embeddings on document upload or item creation. Groq `llama-3.3-70b` or `nomic-embed-text` for embedding generation (free tier).

---

### M-02: Document OCR + AI Field Extraction
**What:** When a user uploads a PDF (government notice, GST certificate, TDS challan, ITR acknowledgement, PCB consent), the system automatically extracts structured data: notice number, issuing authority, demand amount, reply deadline, ARN/SRN, PAN/GSTIN, period, date. Extracted data pre-fills the relevant fields on the compliance item or notice register. Human reviews and confirms.
**Why Must Have:** This is the #1 AI feature that immediately demonstrates product value. Without it, every compliance record requires manual data entry — slow and error-prone. With it, the user uploads a notice PDF and the form fills itself. The "wow" moment in every demo. Uses pdf-parse (open source) + Groq Llama 3.2 Vision (free tier) for extraction. Cost: $0.
**Minimum scope:** PDF upload → pdf-parse for text extraction → Groq structured output prompt → JSON with extracted fields → pre-fill form. Human confirm/edit step before saving. Supported document types: GST notice, TDS challan, ITR acknowledgement, PF challan, ROC SRN receipt.

---

### M-03: Open API with Access Code (Customer Data API)
**What:** Every customer gets a unique API access code (secret key) generated in Settings → API. This key allows external tools to: GET compliance items, GET notices, GET audit logs, POST new compliance items, PATCH item status, and GET documents list. Full REST API with OpenAPI/Swagger documentation at `/api/docs`. Rate-limited per plan tier.
**Why Must Have:** This is what makes the platform an OS rather than a closed SaaS. A CA firm's custom script can pull all client compliance statuses. A customer's ChatGPT Custom GPT can query their live compliance data. A customer's ERP can push challan data in. An access code with read/write scopes costs nothing to build but unlocks the entire "bring your own AI" use case. Without this, the platform is a dead end.
**Minimum scope:** `api_keys` table (key hash, org_id, name, scopes, created_at, last_used_at, is_active). Key generation in Settings → API Access. API authentication middleware (Bearer token → look up org). Public OpenAPI schema. Rate limit: 100 req/min on free, 1000 req/min on paid.

---

### M-04: BYOK AI Integration (Bring Your Own Key)
**What:** In Settings → AI Configuration, the customer enters their own API keys: OpenAI, Anthropic, Groq, or Google AI. Keys are stored encrypted in Supabase Vault. All AI features (document extraction, Q&A, draft generation) use the customer's key — billed to the customer's AI account, not the platform. A "Use Platform AI" fallback (Groq free tier) is available for customers without their own key.
**Why Must Have:** This is how the platform's AI operating cost stays at $0. The customer owns their AI relationship. They can use free Groq (Llama 3.3 70B), free Gemini API, or their existing ChatGPT subscription. The platform just routes the call. Customers who already pay for OpenAI or Claude will love this — they get compliance intelligence without a separate AI subscription cost.
**Minimum scope:** Settings → AI page with: key input fields per provider, test connection button, "which AI to use for what" selector (document extraction / Q&A / drafting). Keys encrypted at rest using Supabase Vault. Platform fallback: Groq free tier (Llama 3.3 70B) — no customer key required.

---

### M-05: Groq Orchestrator Agent (Edge Function)
**What:** A Supabase Edge Function that acts as the orchestration layer. Triggered by database events (document uploaded, notice created, item overdue, deadline approaching). Routes each trigger to the appropriate sub-agent: document parser, compliance classifier, email drafter, escalation notifier. Uses Groq API (Llama 3.3 70B) as the orchestrator model — free tier covers thousands of daily triggers.
**Why Must Have:** Without orchestration, each AI feature is a disconnected button the user must click. With the orchestrator, the system acts automatically: notice uploaded → AI extracts data → compliance item created → escalation email drafted → user approves. This is the "super boss" that runs the compliance workflow. Groq's free tier (6,000 req/day) is sufficient for first 500 customers.
**Minimum scope:** `orchestrator` Edge Function listening to Supabase Realtime events. Event types: `document.uploaded`, `item.overdue`, `notice.received`, `deadline.approaching`. Each event type has a pre-defined agent action. Groq API call for classification/routing. Output: structured JSON action (update field X, send notification Y, create record Z). Full action log in audit_logs table.

---

### M-06: Semantic Search Across All Compliance Data
**What:** Replace or augment the existing keyword search (Cmd+K) with vector similarity search. User types "show me all GST matters related to ITC reversal" — system returns semantically relevant compliance items, notices, and documents even if those exact words don't appear. Powered by pgvector (M-01).
**Why Must Have:** As the compliance database grows (hundreds of items, dozens of notices, years of history), keyword search breaks down. A CA asking "find all things related to the 2023 IT scrutiny for Client A" needs semantic retrieval, not substring matching. This is table-stakes for an AI-native product — it is what makes the data useful at scale.
**Minimum scope:** Query input → generate query embedding → pgvector cosine similarity search → rank and return top 10 results across compliance_items + notices + documents. Display with relevance indicator. Powered by Groq embedding model (free).

---

### M-07: Recurring Compliance Engine
**Source:** Claude + Z.ai (upgraded from Z.ai's Good to Have)
**What:** Mark a compliance item as recurring (monthly / quarterly / half-yearly / annually). System auto-generates the next instance when current is marked "Completed." Carries forward: assignee, department, type, GSTIN/registration number, recurrence schedule.
**Why Must Have:** GST, TDS, PF, ESIC all repeat on fixed schedules. Without auto-generation, users manually create 300+ items per month. The platform cannot be used for ongoing compliance management without this.
**Minimum scope:** `recurrence_type` enum field on compliance_items. `recurrence_parent_id` for lineage. Trigger: when item marked Completed → create next instance with due_date = formula(recurrence_type). Edge Function handles the auto-creation.

---

### M-08: India Compliance Calendar + Entity-Type Auto-Suggestion
**Source:** Claude + Z.ai M1+M2
**What:** Library of 60+ standard Indian compliance obligations with pre-populated due dates, mapped to entity type. Create a Pvt Ltd → system suggests 15 mandatory annual compliances. Select "GSTR-3B Monthly" → due date auto-fills 20th of next month. Covers all 10 compliance types.
**Why Must Have:** Proves domain expertise in the first 5 minutes. Eliminates setup friction. Reduces date-entry errors (most common compliance miss cause). Essential for the "quick win" onboarding moment.
**Minimum scope:** JSON template library (60 entries). Quick-add picker on Compliance → New. Entity-type-based suggestion modal on first org setup.

---

### M-09: Period / Financial Year Field (April–March)
**Source:** Claude + Z.ai M3
**What:** Period field on compliance items (June 2026 / Q1 FY2026-27 / AY2026-27). Dashboard and calendar group by Indian FY (April–March).
**Why Must Have:** Without period, 12 monthly GSTR-3B items are indistinguishable. Every chart and report that defaults to January–December is wrong for Indian compliance.

---

### M-10: Acknowledgement / ARN / Reference Number Field
**Source:** Claude Must Have
**What:** Field on compliance items to record government-issued acknowledgement: ARN (GST), ITR ack, SRN (ROC), TDS receipt. The AI document extractor (M-02) pre-fills this automatically from uploaded PDFs.
**Why Must Have:** "Completed" without an ARN is not a compliance record. The ARN is the proof of filing that every auditor, department, and client asks for.

---

### M-11: Challan Payment Tracking
**Source:** Claude Must Have | Z.ai Good to Have — overruled
**What:** Challan section on each compliance item: BSR code, challan serial number, payment date, amount, bank. AI document extractor (M-02) pre-fills from uploaded challan PDF automatically.
**Why Must Have:** Filing ≠ Payment in Indian law. Statutory auditors require payment evidence. "Completed" with no BSR code fails audit season.

---

### M-12: Government Notice / SCN Register
**Source:** Claude Must Have | Z.ai Good to Have — overruled
**What:** Module to log incoming notices: notice number, authority, date received, demand amount, reply deadline (auto-calculated), assigned to, status, documents. AI (M-02) auto-extracts all fields from uploaded notice PDF. Dashboard widget: notices with reply deadline in next 7 days.
**Why Must Have:** Missed notice reply = ex-parte demand order = CFO personal liability. AI extraction from notice PDF removes all friction — user just uploads the notice, everything else is done.

---

### M-13: Email Notifications (External — Verified Delivery)
**Source:** Claude + Z.ai M4
**What:** External email deadline reminders (7 days / 3 days / 1 day / due date / 1 day after). Notice reply deadline reminders. Powered by Resend (free: 100/day). Edge Function cron triggers daily.
**Why Must Have:** Users are not in the app all day. Without external notifications, the product fails its core promise of "nothing falls through the cracks."

---

### M-14: Registration Number Fields on Compliance Items
**Source:** Claude Must Have
**What:** GSTIN / TAN / PAN / CIN / PF Code field on compliance items, auto-labelled based on compliance type. Pre-fills from entity's registration data where available. AI extractor (M-02) pulls from uploaded documents.
**Why Must Have:** A compliance tracker with no registration number on the filing is a task list, not a compliance register.

---

### M-15: Bulk Import via CSV + AI-Assisted Import
**Source:** Claude Must Have | Z.ai Good to Have — upgraded
**What:** Upload CSV to bulk-create compliance items. Standard template download. Row-by-row validation. **New:** AI-assisted import — user uploads a messy Excel compliance tracker; AI maps columns to system fields, suggests corrections, and creates items in bulk.
**Why Must Have:** First-day onboarding gate. A company with 200 compliance items cannot set up manually. AI-assisted import removes even the "I need to clean my data first" objection.

---

### M-16: Outbound Webhooks (Push Compliance Events to Customer Systems)
**What:** Customer configures webhook URLs in Settings → Integrations. On events (item.completed, item.overdue, notice.received, challan.recorded), the system POSTs a JSON payload to the customer's URL. Customer's ERP, CA software, or Zapier workflow receives the event.
**Why Must Have:** This is the Data Out layer that makes the platform an OS rather than a closed tool. A customer's Tally receives "GST paid — ₹2.3L" from the compliance platform. A CA firm's system receives "client GSTR-3B filed" automatically. Without webhooks, the platform is a dead end that requires manual data transfer everywhere.
**Minimum scope:** `webhooks` table (url, events[], secret, is_active). Event delivery with HMAC signature. Retry on failure (3 attempts, exponential backoff). Webhook log in Settings → Integrations. Edge Function handles delivery.

---

### M-17: Free Trial + Self-Serve Signup
**Source:** Claude + Z.ai M8
**What:** 14-day free trial. No credit card. Full feature access. Trial countdown banner from day 10. Read-only after day 15.
**Why Must Have:** No self-serve = no growth at zero marketing spend.

---

### M-18: Public Pricing Page
**Source:** Claude + Z.ai M8
**What:** `/pricing` with 3 tiers, feature comparison, annual/monthly toggle. Free Trial CTA.
**Why Must Have:** Cannot answer "what does it cost?" = lost deals and failed demos.

---

### M-19: Improved Landing Page with Value Proposition + Public Penalty Calculator ✅
**Source:** Z.ai M9 + Claude
**Status:** ✅ COMPLETED (2026-06-30) — Landing page rewritten with value-prop hero, feature cards, public penalty calculator (GST/TDS/PF/Income Tax), trust logos, how-it-works flow, CTA sections. Rebranded to Veridian AI with real logo SVGs.
**What:** Rewrite landing page: specific outcome headline ("Never miss a compliance deadline — AI fills the form from your notice PDF"), 60-second product GIF, public-facing penalty calculator (no login), clear Free Trial CTA. The penalty calculator is the #1 lead magnet — put it on the home page.
**Why Must Have:** Current tagline ("One Portal. One Truth.") is brand, not conversion copy. Finance Manager lands and needs to see their specific problem solved in 10 seconds.
**Implemented:**
- Full landing page with 8 sections: Hero (AI extraction demo), Trust Bar (8 compliance types), AI Features Grid (6 cards), Public Penalty Calculator (6 Indian compliance types with official rates), How It Works (4-step flow), Compliance Types (60+ obligations), Open Platform Architecture, CTA + Footer
- Interactive penalty calculator supporting GST (18% p.a. + ₹200/day max ₹5,000), TDS (1.5%/month), PF (12% p.a.), Income Tax (1%/month), MCA (₹100/day max ₹1L), ESIC (12% p.a.)
- Veridian AI branding with logo-mark.svg and logo-compact.svg
- Framer Motion animations, mobile responsive, shadcn/ui components
- Deployed at https://verdian-ai.vercel.app/

---

### M-20: Help Centre + AI Support Bot + In-App Onboarding
**Source:** Claude + Z.ai
**What:** 15 help articles (Markdown). In-app 5-step onboarding checklist. **AI support bot** powered by pgvector RAG (M-01) — user asks "how do I add a GSTIN?" and the bot retrieves the relevant help article and answers in context. The bot runs on Groq free tier. Cost: $0.
**Why Must Have:** Without AI support, founders answer every support question manually. The AI bot trained on help docs handles 80% of tier-1 questions automatically.

---
---

# TIER 2 — GOOD TO HAVE
### Unlock higher-paying segments, reduce churn, improve conversion. Required to reach 500 customers.

---

### G-01: MCP Server Interface (Compliance Data as MCP Tool)
**What:** Expose the platform's API as an MCP (Model Context Protocol) server. Any MCP-compatible AI client (Claude Desktop, Cursor, custom agents) can connect using the customer's access code and query compliance data natively. "What GST filings are due this week?" from Claude Desktop returns live data from the platform.
**Why Good to Have:** MCP is rapidly becoming the standard for AI-tool integration. A customer who connects their AI assistant to the compliance platform via MCP never needs to open the web app — they manage compliance from their existing AI interface. This is the future of the product but requires stable API (M-03) first.

---

### G-02: AI Compliance Q&A (RAG on Customer's Own Data)
**What:** Chat interface inside the platform. Customer asks: "How many GST notices have we received this year?" or "Which compliance items are overdue for our Karnataka GSTIN?" The AI uses pgvector RAG to search the customer's actual data and returns a grounded, factual answer — not a hallucination. Uses BYOK key (M-04) or Groq fallback.
**Why Good to Have:** This is the feature that makes the platform "intelligent" rather than just a tracker. The first customer who asks "summarise all pending compliances for my board meeting next week" and gets an accurate answer in 10 seconds will never leave.

---

### G-03: AI Notice Reply Drafter
**What:** When a government notice is logged (M-12), offer "Draft Reply." AI reads the notice content (from pgvector), retrieves relevant Indian tax law from the knowledge base, and drafts a reply letter covering: acknowledgement of the notice, factual response to the specific allegation, supporting document references, and signature block. Human lawyer/CA reviews and edits before sending.
**Why Good to Have:** Notice reply drafting is a high-value, billable activity for CA firms. If the platform drafts the first version in 30 seconds, it saves 2–3 hours of CA time per notice. Strong retention driver and word-of-mouth trigger. Requires M-12 (notice register) and M-02 (document extraction) to be in place first.

---

### G-04: Indian Tax Law Knowledge Base (Pre-loaded pgvector)
**What:** Pre-load embeddings of: all CBIC GST notifications and circulars (2017–present), CBDT Income Tax circulars, MCA company law updates, and key High Court / Supreme Court judgements on tax matters. Stored in pgvector `knowledge_base` table. Used by AI Q&A (G-02) and Notice Reply Drafter (G-03) for grounded, cited answers.
**Why Good to Have:** Without this knowledge base, AI answers are generic (trained on public internet data up to cutoff). With it, the AI can answer: "Is there any CBIC circular that allows ITC credit on this specific expense?" with a cited, current answer. This is the moat — a compliance platform with current Indian regulatory intelligence baked in.

---

### G-05: Multi-Client Architecture (CA Practice Edition)
**Source:** Claude + Z.ai G8
**What:** Firm-level account managing multiple client organisations. Top-level client switcher. Consolidated "All Clients" overdue dashboard. Each client's data isolated. Read-only client portal (client logs in to view their own dashboard).
**Why Good to Have:** CA firms are the highest-density referral channel. Requires significant schema change (firm → client relationship). V2 priority after PMF confirmed.

---

### G-06: Tally Integration (Basic — CSV Import + Auto-Parsing)
**Source:** Z.ai Good to Have | Claude upgraded from Ignore
**What:** Import Tally Prime CSV exports (TDS deductions report, GST liability report). AI parser reads the Tally CSV format and creates corresponding compliance items (TDS payment due on 7th, GST payment due before GSTR-3B). No Tally API — just CSV import with AI column mapping.
**Why Good to Have:** Tally has 90%+ Indian SME market share. "We already have Tally" is the #1 objection. With this feature: "We connect to Tally — upload the weekly report and we create all your TDS and GST obligations automatically."

---

### G-07: Compliance Health Score (0–100)
**Source:** Z.ai G14
**What:** Single score per organisation: computed from completion rate, overdue %, average days-to-file, notice response rate. Dashboard widget. Trend (up/down from last month). Colour-coded Green/Yellow/Red.
**Why Good to Have:** The CFO and CEO can read this in 2 seconds. It gamifies compliance management. "Our compliance score went from 62 to 88 this quarter" is the renewal conversation hook.

---

### G-08: Annual Compliance Calendar View
**Source:** Claude
**What:** 12-month calendar grid. Compliance items as colour-coded blocks on due dates. Colour by type. Click to open. April–March FY view. The best demo visual in compliance software.

---

### G-09: Approval Workflow (2-Level Maker-Checker)
**Source:** Claude Must Have | Z.ai Good to Have — keeping in Good to Have for this reframed list (AI extraction reduces the manual review burden; approval workflow is still valuable but less urgent when AI pre-validates)
**What:** Assignee submits for review. Reviewer approves or rejects with comment. Audit log records approver + timestamp.
**Why Good to Have:** Corporate governance standard for companies above 100 employees. Depends on M-10 (ARN field) and M-11 (challan tracking) being in place so the reviewer has something to check.

---

### G-10: Escalation Engine (Configurable Rules)
**Source:** Claude
**What:** Configurable escalation: if item not updated 7 days before due → notify assignee. If 3 days before → notify Dept Head. If on due date → notify Admin. Rules in Settings → Escalation Matrix.
**Why Good to Have:** CFO evaluator: "I need a system that chases my team so I don't have to." Unlocks mid-market ACV.

---

### G-11: Hierarchical Dashboard Views (Role-Scoped)
**Source:** Z.ai (upgraded from Ignore)
**What:** Admin/CFO sees all. Manager sees their department only. Member sees assigned items only. Auto-applied based on role — no configuration.
**Why Good to Have:** Basic multi-user product design. High impact for mid-market team adoption at low engineering effort.

---

### G-12: Location / Branch Management
**Source:** Claude
**What:** `locations` table (name, type: office/factory/warehouse, city, state). Assign compliance items to locations. Filter dashboard by location.
**Why Good to Have:** Required for multi-state, multi-location companies. SME buyers use departments as proxy.

---

### G-13: TDS/TCS Section-Wise Tracking
**Source:** Z.ai G3
**What:** TDS section selector on compliance items: 192 (salary), 194C (contractor), 194I (rent), 194J (professional fees), etc. Section-wise TDS summary in reports. AI extractor (M-02) reads section from uploaded TDS challan.
**Why Good to Have:** TDS is the most voluminous tax compliance — every company deducts under multiple sections. Section-wise tracking makes the TDS module genuinely useful.

---

### G-14: ROC / MCA Compliance Module (Dedicated)
**Source:** Z.ai G11
**What:** AOC-4, MGT-7, MGT-14, DIR-3 KYC, ADT-1 — auto-suggested based on company type. SRN tracking. Due dates relative to AGM date. AI extracts SRN from uploaded MCA filing acknowledgement.
**Why Good to Have:** ROC is mandatory for every company. Dedicated module unlocks CS (Company Secretary) as a user persona.

---

### G-15: Multi-GSTIN Register
**Source:** Claude + Z.ai G12
**What:** Org-level GSTIN register: state, type (Regular/Composition/SEZ), registration date, status. GST compliance items link to specific GSTIN. Required for multi-state companies.

---

### G-16: Financial Exposure Dashboard Widget
**Source:** Claude
**What:** Dashboard widget: "Estimated penalty if all overdue items remain unfiled today: ₹X." Auto-computed from overdue items × delay days × penalty rates. Requires `amount` field on compliance items.
**Why Good to Have:** Makes compliance urgency tangible in money. CFOs check this daily.

---

### G-17: Mobile PWA
**Source:** Claude + Z.ai G6
**What:** PWA configuration (manifest.json, service worker). Home screen icon. Push notifications. Full mobile optimisation. Field managers update compliance from phone.

---

### G-18: WhatsApp Notification Integration
**Source:** Claude + Z.ai G1
**What:** Deadline alerts via WhatsApp Business API (Interakt/Gupshup). 95% read rate vs. 20% email. Build at 200+ customers.

---

### G-19: Board / Audit Committee PDF Report
**Source:** Claude
**What:** AI-generated quarterly compliance report (PDF): completion %, overdue, penalties paid, notices summary, trend vs. last quarter. AI writes the narrative section from the data. Renewal lock-in feature.

---

### G-20: Email Template Customisation
**Source:** Z.ai G16
**What:** CA firms customise reminder emails to show their firm name. Admin previews before saving. Low effort, high perceived value for CA segment.

---

### G-21: Filed Date + Payment Date Fields
**Source:** Claude
**What:** "Filed On" and "Paid On" date fields on compliance items (separate from "Completed At"). Enables accurate penalty calculation: actual filing date vs. due date.

---

### G-22: Staff Workload + Performance View
**Source:** Claude
**What:** Per-user: items assigned, completed in 30 days, overdue, average days-to-complete. Capacity planning for managers.

---

### G-23: SSO / Google / Microsoft Login
**Source:** Claude
**What:** Supabase Auth supports both natively — 1-day configuration task. Required for mid-market procurement.

---

### G-24: Document Version Control
**Source:** Claude
**What:** Version history on uploaded documents. Latest marked as current. Distinguishes draft Form 3CD from final signed version.

---

### G-25: Public ROI Calculator
**Source:** Claude
**What:** Landing page ROI calculator (no login). Inputs: company size, states, GSTINs, historical penalties. Output: estimated savings vs. software cost. Top-of-funnel lead magnet.

---

### G-26: Public Roadmap + G2/Capterra Listing
**Source:** Claude
**What:** `/roadmap` page with upvoting. G2/Capterra listings with 5 beta reviews. Product exists in the prospect's research phase.

---
---

# TIER 3 — CAN BE IGNORED
### Do not build before 500+ customers. Premature complexity, niche markets, or non-engineering work.

---

### I-01: Direct Government Portal Filing (GST Portal, TRACES, MCA21)
**Why ignore:** This product does NOT file. It tracks. Government portal APIs (GSTN, MCA21, TRACES) require GSP licence (6–12 month regulatory process) or intermediary registration. We record the acknowledgement after the user files — we do not replace the portal.

---

### I-02: EXIM / Import-Export Compliance Module (DGFT, Advance Auth, EPCG, RODTEP)
**Why ignore:** Relevant only to active EXIM companies. Deep DGFT domain knowledge required. "Other" compliance type handles basic tracking. Build when 3+ enterprise EXIM customers ask with budget.

---

### I-03: Factory / Industrial Compliance Lifecycle (PCB Consent, Boiler Certificates)
**Why ignore:** Manufacturing-specific. "Environmental" type handles basic tracking. Licence-condition linkage is complex to model. Build when manufacturing is a primary customer segment.

---

### I-04: Fire + Safety Dedicated Module
**Why ignore:** Fire NOC, extinguisher certs, mock drills — tracked under "Other" with location tags. Dedicated module adds complexity without new data capability.

---

### I-05: C&F Agent / Third-Party Vendor Compliance Portal
**Why ignore:** Requires a separate external portal — effectively a second product. V3 for logistics companies.

---

### I-06: Contract Labour Compliance Module
**Why ignore:** Factories Act + CLRA Act — relevant to factory/warehouse operators. "Labour" type handles basic tracking. Build when manufacturing is primary segment.

---

### I-07: Full ERP Integration (SAP / Oracle bidirectional sync)
**Why ignore:** Vendor partnership, dedicated API maintenance, enterprise SLAs required. Development cost exceeds first 100 customers' revenue. Tally basic CSV import (G-06) is the correct stepping stone. Webhooks (M-16) cover the outbound side.

---

### I-08: AI/ML Predictive Analytics ("you will miss this filing based on past patterns")
**Why ignore:** Requires 2+ years of customer data to be meaningful. Build after 10,000+ compliance items are in the system. Use pgvector (M-01) foundation to enable this later.

---

### I-09: SOC 2 Type II / ISO 27001 Certification
**Why ignore now:** A process, not a feature. 12–18 months preparation. Implement security practices now (already done), document them, pursue certifications post-Series A when enterprise sales motion justifies cost.

---

### I-10: CA Billing / Professional Fee Tracking
**Why ignore:** Requires multi-client architecture (G-05) first. Building billing before multi-client is a room without a foundation.

---

### I-11: Board Meeting + Corporate Governance Calendar
**Why ignore:** Too narrow — relevant to listed companies with active board schedules. Company Secretaries manage this manually. Niche within a niche.

---

### I-12: Insurance Compliance Tracking
**Why ignore:** Different buyer persona (admin/HR), different tool. Adds UI clutter for the core compliance user.

---

### I-13: Real Estate / Property Compliance (RERA, property tax)
**Why ignore:** Vertical-specific. Build a separate product for this segment.

---

### I-14: Bank / FI Compliance (CMA Data, LC/BG Tracking)
**Why ignore:** Treasury tool, not compliance tool. Different user, different regulatory domain.

---

### I-15: Multi-Currency / Multi-Country Support
**Why ignore:** Product is explicitly Indian. Internationalise at Series B.

---

### I-16: Native iOS / Android Apps
**Why ignore:** PWA (G-17) delivers 60% of the value at 20% of the cost. Native apps are V3 if PWA proves insufficient.

---

### I-17: Partner / Channel Sales Programme
**Why ignore:** Go-to-market activity, not a product feature. Start informally with 5 CA referral partners — if it works, formalise it.

---

### I-18: Contingent Liability Disclosure Tracker (Balance Sheet Notes under AS 29)
**Why ignore:** Financial accounting feature requiring accounting system integration. Too specialised.

---

### I-19: FEMA / RBI Transaction Reporting
**Why ignore:** Relevant only to companies with foreign investments. Covered by specialist software.

---

### I-20: Multi-State Professional Tax Dedicated Module (18-state PT)
**Why ignore:** A generic PT item with state tag (G-12 location management) handles adequately. Full 18-state module is niche within a niche — implement only as a paid upsell after 200 customers.

---
---

## Master Summary Table

| ID | Feature | Tier | Effort | Cost | AI-Powered |
|---|---|---|---|---|---|
| M-01 | pgvector schema + document embedding pipeline | **Must Have** | Low | $0 (Supabase + Groq free) | ✅ Yes |
| M-02 | Document OCR + AI field extraction | **Must Have** | Medium | $0 (pdf-parse + Groq Vision) | ✅ Yes |
| M-03 | Open API with access codes | **Must Have** | Medium | $0 | No |
| M-04 | BYOK AI key management | **Must Have** | Low | $0 (customer pays own AI) | ✅ Yes |
| M-05 | Groq orchestrator agent (Edge Function) | **Must Have** | Medium | $0 (Groq free tier) | ✅ Yes |
| M-06 | Semantic search (pgvector) | **Must Have** | Low | $0 | ✅ Yes |
| M-07 | Recurring compliance engine | **Must Have** | High | $0 | No |
| M-08 | India compliance calendar + entity auto-suggest | **Must Have** | Medium | $0 | No |
| M-09 | Period / financial year field (April–March) | **Must Have** | Low | $0 | No |
| M-10 | Acknowledgement / ARN / reference number field | **Must Have** | Low | $0 | Partial (M-02 auto-fills) |
| M-11 | Challan payment tracking | **Must Have** | Medium | $0 | Partial (M-02 auto-fills) |
| M-12 | Government notice / SCN register | **Must Have** | Medium | $0 | ✅ Yes (M-02 extracts) |
| M-13 | Email notifications (verified external) | **Must Have** | Low | $20/month (Resend) | No |
| M-14 | Registration number fields on compliance items | **Must Have** | Low | $0 | Partial (M-02 auto-fills) |
| M-15 | Bulk import (CSV + AI-assisted column mapping) | **Must Have** | Medium | $0 | ✅ Yes |
| M-16 | Outbound webhooks | **Must Have** | Medium | $0 | No |
| M-17 | Free trial + self-serve signup | **Must Have** | Low | $0 | No |
| M-18 | Public pricing page | **Must Have** | Low | $0 | No |
| M-19 | Improved landing page + public penalty calculator | **Must Have** | Low | $0 | ✅ Yes |
| M-20 | Help centre + AI support bot + onboarding | **Must Have** | Low | $0 (Groq RAG) | ✅ Yes |
| G-01 | MCP server interface | Good to Have | Medium | $0 | ✅ Yes |
| G-02 | AI compliance Q&A (RAG on customer data) | Good to Have | Medium | $0 (BYOK/Groq) | ✅ Yes |
| G-03 | AI notice reply drafter | Good to Have | Medium | $0 (BYOK) | ✅ Yes |
| G-04 | Indian tax law knowledge base (pgvector) | Good to Have | High | $0 | ✅ Yes |
| G-05 | Multi-client architecture (CA Edition) | Good to Have | Very High | $0 | No |
| G-06 | Tally CSV import + AI column mapping | Good to Have | Medium | $0 | ✅ Yes |
| G-07 | Compliance health score (0–100) | Good to Have | Low | $0 | No |
| G-08 | Annual compliance calendar view | Good to Have | Medium | $0 | No |
| G-09 | Approval workflow (maker-checker) | Good to Have | Medium | $0 | No |
| G-10 | Escalation engine | Good to Have | High | $0 | No |
| G-11 | Hierarchical role-scoped dashboard | Good to Have | Medium | $0 | No |
| G-12 | Location / branch management | Good to Have | High | $0 | No |
| G-13 | TDS/TCS section-wise tracking | Good to Have | Medium | $0 | Partial |
| G-14 | ROC/MCA dedicated module | Good to Have | Medium | $0 | Partial |
| G-15 | Multi-GSTIN register | Good to Have | Medium | $0 | No |
| G-16 | Financial exposure widget (₹X at risk today) | Good to Have | Low | $0 | No |
| G-17 | Mobile PWA | Good to Have | Medium | $0 | No |
| G-18 | WhatsApp notifications | Good to Have | High | Per-message | No |
| G-19 | AI board report generator (PDF) | Good to Have | High | $0 (BYOK) | ✅ Yes |
| G-20 | Email template customisation | Good to Have | Low | $0 | No |
| G-21 | Filed date + payment date fields | Good to Have | Low | $0 | No |
| G-22 | Staff workload + performance view | Good to Have | Medium | $0 | No |
| G-23 | SSO / Google / Microsoft login | Good to Have | Low | $0 | No |
| G-24 | Document version control | Good to Have | Medium | $0 | No |
| G-25 | Public ROI calculator | Good to Have | Low | $0 | No |
| G-26 | Public roadmap + G2/Capterra listing | Good to Have | Low | $0 | No |
| I-01 to I-20 | (see Tier 3 section) | Ignore | — | — | — |

**Totals: 20 Must Have | 26 Good to Have | 20 Can Be Ignored (66 total)**
**AI-powered features: 13 Must Have + 9 Good to Have = 22 AI features**
**Estimated total infrastructure cost for first 200 customers: $20–50/month**

---

## Recommended Build Sequence

**Sprint 1 (Weeks 1–2): AI Foundation + Acquisition**
- M-01: pgvector schema (activate extension, embeddings table) — 1 day
- M-04: BYOK AI key management (Settings → AI) — 2 days
- M-17: Free trial flow — 2 days
- M-18: Pricing page — 1 day
- M-19: Landing page rewrite + public penalty calculator — 3 days
- M-20: Help centre (static articles) + onboarding checklist — 2 days

**Sprint 2 (Weeks 3–4): Data Completeness**
- M-09: Period / FY field — 1 day
- M-10: ARN / acknowledgement field — 1 day
- M-14: Registration number fields — 1 day
- G-21: Filed date + payment date — 1 day
- M-03: Open API with access codes — 3 days
- M-16: Outbound webhooks — 3 days

**Sprint 3 (Weeks 5–6): AI Document Intelligence**
- M-02: Document OCR + AI extraction (pdf-parse + Groq Vision) — 5 days
- M-06: Semantic search (pgvector similarity) — 3 days
- M-05: Groq orchestrator agent (Edge Function, basic routing) — 2 days

**Sprint 4 (Weeks 7–8): Scale + Automation**
- M-07: Recurring compliance engine — 4 days
- M-08: India compliance calendar + entity auto-suggest templates — 3 days
- M-15: Bulk CSV import + AI column mapping — 3 days

**Sprint 5 (Weeks 9–10): Risk + Evidence**
- M-11: Challan payment tracking (+ AI auto-fill from M-02) — 3 days
- M-12: Government notice / SCN register (+ AI extraction from M-02) — 4 days
- M-13: External email notifications (Resend Edge Function cron) — 2 days

**Sprint 6 (Weeks 11–12): Intelligence Layer**
- G-02: AI compliance Q&A (RAG on customer data) — 4 days
- G-07: Compliance health score — 2 days
- G-08: Annual calendar view — 3 days
- G-11: Hierarchical role-scoped dashboard — 1 day

**Sprint 7 (Weeks 13–14): Market Visibility**
- G-04: Indian tax law knowledge base (pre-load CBIC/CBDT circulars into pgvector) — 3 days
- G-06: Tally CSV import + AI parsing — 3 days
- G-26: G2/Capterra listing (business action) — ongoing
- G-01: MCP server interface — 3 days

**Post-Sprint 7: Based on PMF signals**
- CA firms dominant → G-05 (multi-client architecture)
- Mid-market dominant → G-12 (locations), G-09 (approval workflow), G-10 (escalation)
- AI usage high → G-03 (notice reply drafter), G-19 (board report generator)
- Mobile demand high → G-17 (PWA)

---

## The Zero-Cost Proof

| Cost Item | Solution | Monthly Cost |
|---|---|---|
| Database + Auth + Storage | Supabase (free → $25 Pro) | $0–$25 |
| Hosting + CDN | Vercel (free tier) | $0 |
| AI orchestration | Groq free tier (Llama 3.3 70B, 6K req/day) | $0 |
| Document extraction | pdf-parse (open source) + Groq Vision (free) | $0 |
| AI features (customer-facing) | BYOK — customer pays their own OpenAI/Anthropic bill | $0 |
| Email notifications | Resend (100/day free → $20/month for 50K) | $0–$20 |
| CI/CD | GitHub Actions (free public repo) | $0 |
| DNS + CDN | Cloudflare (free tier) | $0 |
| Support | AI bot on Groq RAG (pgvector help docs) | $0 |
| Monitoring | Vercel Analytics (free) + Supabase logs | $0 |
| **Total for first 200 customers** | | **$20–$45/month** |

The first ₹10 lakh ARR costs ₹3,500–4,000/month to serve. Net margin from day one: 99%+.

---

*Document prepared by: DEVABOSS / Claude Code*
*Sources: evaluation_by_ca.md (6 evaluations), Z.ai feature audit, full codebase review, architectural analysis*
*Framework: Compliance & Audit OS — not tax filing — with AI-native, open-API, BYOK, pgvector, near-zero-cost architecture*
*Date: 2026-06-29*
*Living document. Update after each sprint.*
