# CIMScan Development Handoff
**Date:** 2026-03-05
**Version:** v1.7.2
**Entity Chain:** True Bearing LLC → IC Sentinel → CIMScan

---

## What Is CIMScan

CIMScan is an automated investment diligence platform. Private equity firms email a Confidential Information Memorandum (CIM) to CIMScan, and the system runs a six-stage analytical pipeline powered by Claude, producing:

1. **Dataset D** — a 12-sheet Excel workbook containing the full claim register, underwriting gates, workstream execution plan, interdependency analysis, thesis pillars, and validation checks.
2. **IC Insights** — a narrative Word document with three analytical voices (sympathetic analyst, skeptical IC partner, domain expert) designed for investment committee consumption.
3. **CIMScan Run Summary** — a Markdown executive summary.

The system charges per run via Stripe (authorize on config, capture on completion, release on failure). No charge is applied if the CIM fails the Quality Gate.

---

## Architecture Overview

```
User emails CIM PDF
        │
        ▼
  Mailgun webhook → api/src/routes/ingest.ts
        │
        ▼
  FROM lookup → users table (case-insensitive)
        │
        ▼
  Deal created (status: received)
        │
        ▼
  User clicks Configure link in email
        │
        ▼
  web/src/app/deals/[id]/configure/page.tsx
  (select CORE/FULL, accept terms, pay via Stripe)
        │
        ▼
  api/src/routes/deals.ts → triggerPipeline()
        │
        ▼
  api/src/services/pipeline.ts (six sequential API calls)
        │
        ├─ Pass 1:  CIM PDF → Quality Gate + Claims (24K tokens)
        ├─ Stage 2: Claims → Underwriting Gates (16K tokens)
        ├─ Stage 3: Stages 1-2 → Workstream Execution (16K tokens)
        ├─ Stage 4: Stages 1-3 → Interdependency Analysis (32K tokens)
        ├─ Stage 5: Stages 1-4 → Thesis Pillars (16K tokens)
        └─ IC Insights: Stages 1-5 → Narrative Synthesis (16K tokens)
        │
        ▼
  api/src/services/outputBuilder.ts
        │
        ├─ Dataset D (.xlsx) → format_dataset_d.py post-processor
        ├─ IC Insights (.docx) → icInsightsBuilder.ts styled template
        └─ Run Summary (.md)
        │
        ▼
  api/src/services/delivery.ts → Supabase Storage + email with signed URLs
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API Server | Express (TypeScript), deployed on Railway |
| Frontend | Next.js (TypeScript + Tailwind), deployed on Railway |
| Database | Supabase (PostgreSQL + RLS + Storage) |
| AI Pipeline | Anthropic Claude Sonnet 4 via Messages API |
| Payments | Stripe (authorize/capture pattern) |
| Inbound Email | Mailgun (webhook to /api/email/ingest) |
| Outbound Email | Mailgun (acknowledgment, config, delivery, rejection emails) |
| Auth | Supabase Auth (email verification) |

---

## Repository Structure

```
cimscan/
├── api/                          Express API server
│   ├── assets/
│   │   └── ec-cim-system-prompt-v1.7.0.md   (Full Reference prompt)
│   ├── migrations/
│   │   ├── 2026-03-05_from_based_routing.sql
│   │   └── 2026-03-05_firms_seed.sql
│   ├── scripts/
│   │   └── format_dataset_d.py               (Dataset D post-processor)
│   ├── src/
│   │   ├── index.ts                          (Express app, route mounting)
│   │   ├── lib/
│   │   │   ├── anthropic.ts                  (Claude API client, 6 stage functions)
│   │   │   ├── mailgun.ts                    (Email sending)
│   │   │   ├── stripe.ts                     (Stripe config, pricing)
│   │   │   └── supabase.ts                   (Supabase client)
│   │   ├── routes/
│   │   │   ├── admin.ts                      (Admin endpoints)
│   │   │   ├── auth.ts                       (Signup, firm search)
│   │   │   ├── deals.ts                      (Deal config, payment, pipeline trigger)
│   │   │   ├── health.ts                     (Health check)
│   │   │   ├── ingest.ts                     (Mailgun webhook, FROM-based routing)
│   │   │   └── stripeWebhook.ts              (Stripe webhook handler)
│   │   └── services/
│   │       ├── delivery.ts                   (Upload outputs, send delivery email)
│   │       ├── icInsightsBuilder.ts          (Styled .docx generator)
│   │       ├── outputBuilder.ts              (Dataset D + IC Insights + Summary)
│   │       ├── payment.ts                    (Authorize/capture/release, shouldRetry)
│   │       ├── pipeline.ts                   (Six-stage orchestrator)
│   │       └── promo.ts                      (Promo code validation/redemption)
│   ├── dist/                                 (Compiled JS output)
│   ├── package.json
│   └── tsconfig.json
├── web/                          Next.js frontend
│   ├── public/
│   ├── src/
│   │   ├── app/
│   │   │   ├── deals/[id]/configure/page.tsx (Deal configuration page)
│   │   │   ├── globals.css
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx
│   │   └── lib/
│   │       └── utils.ts
│   ├── components.json
│   ├── next.config.mjs
│   ├── tailwind.config.ts
│   └── package.json
└── README.md
```

---

## Database Schema (Supabase)

### Tables

**firms**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| name | text | Firm display name |
| contact_email | text | Nullable (legacy, seeded firms don't have one) |
| ingest_address | text | e.g. totalcap@ingest.cimscan.ai |
| stripe_customer_id | text | Nullable |
| website | text | e.g. totalcap.com |
| phone | text | Nullable |
| address | text | Full address string |
| status | text | 'active' (default) |
| created_at | timestamptz | |

**users** (new in v1.7.2)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, matches Supabase Auth uid |
| email | text | Unique (case-insensitive index) |
| firm_id | uuid | FK → firms |
| role | text | 'analyst' or 'admin' |
| status | text | 'active', 'inactive', 'suspended' |
| display_name | text | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**deals**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| firm_id | uuid | FK → firms |
| user_id | uuid | FK → users (new in v1.7.2, nullable for old deals) |
| deal_name | text | From email subject or filename |
| sender_email | text | The FROM address |
| cim_storage_path | text | Path in Supabase Storage cims bucket |
| status | text | received → pipeline_queued → pipeline_running → completed / aborted_not_charged |
| claim_depth | text | 'CORE' or 'FULL' |
| stripe_payment_intent_id | text | Nullable |
| payment_amount_cents | integer | Nullable (0 for promo) |
| terms_accepted_at | timestamptz | |
| source_email_message_id | text | Email Message-ID (new in v1.7.2) |
| ingest_address_used | text | TO address, analytics only (new in v1.7.2) |
| pipeline_abort_code | text | Error code if failed |
| pipeline_abort_reason | text | Human-readable abort reason |
| created_at | timestamptz | |

**inbound_emails** (new in v1.7.2)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| message_id | text | Email Message-ID (unique index for dedup) |
| from_address | text | Sender |
| to_address | text | Logged, not for routing |
| subject | text | |
| attachment_count | integer | |
| attachment_filenames | text[] | |
| user_id | uuid | FK → users (null if unknown sender) |
| firm_id | uuid | FK → firms (null if unknown sender) |
| deal_id | uuid | FK → deals (null if not processed) |
| status | text | processed, unknown_sender, validation_failed, etc. |
| rejection_reason | text | |
| received_at | timestamptz | |
| processed_at | timestamptz | |

**promo_codes** — standard promo code table (validate/redeem logic in promo.ts)

**runs** — (check current schema; may track pipeline run metadata)

### RLS Policies
- Users see their own data
- Firm admins see all firm data
- API server uses service role (bypasses RLS)

### Storage Buckets
- `cims` — uploaded CIM PDFs (`{firm_id}/{timestamp}_{filename}`)
- `outputs` — pipeline deliverables (`{deal_id}/{filename}`)

---

## EC-CIM Analysis Engine

The pipeline is governed by 15 invariants defined in the EC-CIM system prompt (v1.7.0 Full Reference, ~13,400 tokens). Key rules:

- Exactly 5 thesis pillars from a closed set
- Kill thresholds must be quantified (no vague language)
- No investment advice (hard ABORT)
- Stage 4 produces exactly 5 sheets
- Stage 5 requires Stage 4 in same chain
- Relationship strength formula is invariant
- CORE: 20-30 claims (target 25-28), FULL: 45-60 claims

The system prompt lives at `api/assets/ec-cim-system-prompt-v1.7.0.md` and is loaded by `anthropic.ts`. It has not been modified since v1.7.0.

### Pipeline Error Handling
- Each stage checks for: API failure, truncation, missing JSON, abort codes
- `shouldRetry()` returns true for all errors except CIM_ERR_041 (Quality Gate fail)
- On retryable failure: clears abort, re-runs entire pipeline from Pass 1
- Max 1 retry (2 total attempts)
- PIPELINE_ERR_011 (0 claims) is the most common retryable failure

### Output Generation
- `outputBuilder.ts` takes pipeline JSON and produces three buffers
- Dataset D: ExcelJS writes raw workbook → `format_dataset_d.py` applies styling
- IC Insights: `icInsightsBuilder.ts` generates styled .docx (fallback to basic if fails)
- Run Summary: generated as Markdown string
- `delivery.ts` uploads to Supabase Storage and sends email with signed URLs (7-day expiry)

---

## Email Routing (v1.7.2)

**Core principle:** The sender's FROM address is the sole routing key. The TO address is never used for routing.

**Ingest flow (ingest.ts):**
1. Parse envelope (FROM, TO, Subject, Message-ID, attachments)
2. Dedup on Message-ID
3. FROM lookup → users table (case-insensitive)
4. Unknown sender → rejection email, attachment deleted, metadata logged
5. Known sender → validate (user active, firm active, PDF present, ≤32MB, ≤5 queued deals)
6. Upload PDF to Supabase Storage
7. Create deal (linked to user_id + firm_id)
8. Log to inbound_emails
9. Send config email with link to configure page

**Ingest address format:** `{domain_prefix}@ingest.cimscan.ai` (e.g., `totalcap@ingest.cimscan.ai`)

---

## Signup/Onboarding (v1.7.2)

**API (auth.ts):**
- `GET /api/firms?search=total&limit=20` — searchable firm list
- `POST /api/auth/signup` — two paths:
  - Existing firm: `{ email, password, display_name, firm_id }`
  - New firm: `{ email, password, display_name, new_firm_name, new_firm_website, new_firm_address, new_firm_phone }`

**New firm creation:**
1. Normalize website (strip protocol, www, path)
2. Check for duplicate domain in firms table
3. Validate website is reachable (HEAD request, 8s timeout, tries HTTPS/HTTP ± www)
4. Derive ingest address from domain prefix
5. Check for ingest address collision (append random suffix if collision)
6. Create firm row
7. Create Supabase Auth user (triggers email verification)
8. Create users table row (id matches Auth uid for RLS)

**Frontend not yet built** — API endpoints are live and tested.

---

## Payments

- Stripe authorize-on-config, capture-on-completion
- Quality Gate fail → no charge (payment released)
- Pipeline fail after retry → no charge (payment released)
- Promo codes bypass Stripe entirely ($0 deal)
- `shouldRetry()` returns true for all codes except CIM_ERR_041

---

## What Needs Building Next

### 1. Frontend Signup Page (Priority 1)
Next.js page at `web/src/app/signup/page.tsx`:
- Firm dropdown (searchable, calls GET /api/firms)
- "My firm isn't listed" toggle → new firm form (name, website, address, phone)
- Email + password + display name fields
- Submit → POST /api/auth/signup
- Success → "Check your email to verify" screen
- Supabase Auth handles email verification

### 2. Thin Existential Threats (Priority 2)
The IC Insights existential_threats section averages ~1,400 tokens. The prompt in anthropic.ts (executeIcInsights) already asks for external market context, but the model often produces surface-level observations. Tuning options:
- Increase specificity in the prompt (cite specific data sources to draw from)
- Add a follow-up API call that expands each threat with deeper research
- Increase token budget for IC Insights beyond 16K

### 3. FULL Depth Tuning (Priority 3)
CORE (20-30 claims) is tuned and producing 26-28 claims consistently. FULL (45-60 claims) has not been tested. Requires:
- Pass 1 prompt tuning for FULL surface floor quotas (≥6 per major surface, ≥4 Ops)
- Token budget may need increase beyond 24K for Pass 1
- Stage 4 will need proportionally larger output (80+ pairs vs 40)
- End-to-end test run with FULL on a real CIM

### 4. Supabase Auth Configuration
- Enable email verification in Supabase Auth settings
- Configure email templates (verification, password reset)
- Set redirect URLs for email verification links

---

## Environment Variables (API)

| Variable | Purpose |
|----------|---------|
| ANTHROPIC_API_KEY | Claude API access |
| SUPABASE_URL | Supabase project URL |
| SUPABASE_SERVICE_ROLE_KEY | Server-side Supabase access (bypasses RLS) |
| STRIPE_SECRET_KEY | Stripe payments |
| STRIPE_WEBHOOK_SECRET | Stripe webhook signature verification |
| MAILGUN_API_KEY | Email sending |
| MAILGUN_DOMAIN | Sending domain |
| WEB_URL | Frontend URL (for CORS + email links) |
| PORT | API server port (default 3002) |
| EC_CIM_SYSTEM_PROMPT_PATH | Optional override for prompt file location |

---

## Git History (v1.7.2 session — 2026-03-05)

| Commit | Description |
|--------|-------------|
| d249860 | IC Insights styled builder (icInsightsBuilder.ts) |
| bc37c91 | Dataset D formatter + output builder integration |
| dab2583 | 0-claim detection + auto-retry (PIPELINE_ERR_011) |
| dab75ec | FROM-based routing, users table, inbound_emails audit log |
| 301334d | Signup/onboarding API, 600 PE firms seeded, website validation |

---

## Governing Documents

| Document | Version | Purpose |
|----------|---------|---------|
| EC-CIM System Prompt (Full Reference) | v1.7.0 | Primary governing prompt for all pipeline calls |
| EC-CIM Operator Module | v1.7.0 | 15 invariants, 16 error codes, module summaries |
| EC-CIM Glossary | v1.7.0 | 33 term definitions |
| IC Insights Output Spec | v1.7.1 | Narrative template, 3 voices, data boundary rules |
| Email Ingestion Routing Spec | v1.0 | FROM-based routing architecture |
| Release Manifest | v1.7.2 | This release |

---

*CIMScan Handoff v1.7.2 — True Bearing LLC → IC Sentinel → CIMScan*
