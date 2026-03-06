-- =============================================================================
-- CIMScan Migration: FROM-Based Routing + Multi-User
-- Version: v1.7.1
-- Date: 2026-03-05
--
-- Creates:
--   1. users table (multi-user per firm)
--   2. inbound_emails audit table (full ingest logging)
--   3. Indexes for critical-path queries
--   4. RLS policies for firm isolation
--
-- Run this in Supabase SQL Editor or via supabase db push.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. USERS TABLE
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  firm_id       uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'analyst'
                CHECK (role IN ('analyst', 'admin')),
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'inactive', 'suspended')),
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive email lookup (critical path — every inbound email hits this)
CREATE UNIQUE INDEX idx_users_email_lower ON users (LOWER(email));

-- Firm membership lookup
CREATE INDEX idx_users_firm_id ON users (firm_id);

-- Seed initial users from existing firms.contact_email
-- This creates one admin user per firm using the existing contact_email
INSERT INTO users (email, firm_id, role, status, display_name)
SELECT
  f.contact_email,
  f.id,
  'admin',
  CASE WHEN f.status = 'active' THEN 'active' ELSE 'inactive' END,
  f.name || ' (Primary)'
FROM firms f
WHERE f.contact_email IS NOT NULL
  AND f.contact_email != ''
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. INBOUND_EMAILS AUDIT TABLE
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inbound_emails (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id            text,
  from_address          text NOT NULL,
  to_address            text,
  subject               text,
  attachment_count       integer DEFAULT 0,
  attachment_filenames   text[],
  user_id               uuid REFERENCES users(id),
  firm_id               uuid REFERENCES firms(id),
  deal_id               uuid REFERENCES deals(id),
  status                text NOT NULL DEFAULT 'received'
                        CHECK (status IN (
                          'processed',
                          'unknown_sender',
                          'validation_failed',
                          'duplicate',
                          'inactive_user',
                          'inactive_firm'
                        )),
  rejection_reason      text,
  received_at           timestamptz NOT NULL DEFAULT now(),
  processed_at          timestamptz
);

-- Dedup on message_id (email infra can deliver duplicates)
CREATE UNIQUE INDEX idx_inbound_emails_message_id
  ON inbound_emails (message_id)
  WHERE message_id IS NOT NULL;

-- Lookup by from_address for alerting (e.g. unknown sender spam detection)
CREATE INDEX idx_inbound_emails_from_address ON inbound_emails (from_address);

-- Lookup by user for history
CREATE INDEX idx_inbound_emails_user_id ON inbound_emails (user_id);

-- ---------------------------------------------------------------------------
-- 3. DEALS TABLE — add routing context columns
-- ---------------------------------------------------------------------------

-- These columns are logged for analytics/debugging, NOT used for routing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deals' AND column_name = 'source_email_message_id'
  ) THEN
    ALTER TABLE deals ADD COLUMN source_email_message_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deals' AND column_name = 'ingest_address_used'
  ) THEN
    ALTER TABLE deals ADD COLUMN ingest_address_used text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deals' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE deals ADD COLUMN user_id uuid REFERENCES users(id);
  END IF;
END $$;

-- Rate limit check: unprocessed deals per user
CREATE INDEX IF NOT EXISTS idx_deals_user_status
  ON deals (user_id, status)
  WHERE status IN ('received', 'pending_config', 'pipeline_queued', 'pipeline_running');

-- ---------------------------------------------------------------------------
-- 4. ROW-LEVEL SECURITY
-- ---------------------------------------------------------------------------

-- Enable RLS on new tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_emails ENABLE ROW LEVEL SECURITY;

-- Users can read their own record
CREATE POLICY "users_read_own" ON users
  FOR SELECT
  USING (id = auth.uid());

-- Admins can read all users in their firm
CREATE POLICY "users_read_firm_admin" ON users
  FOR SELECT
  USING (
    firm_id = (SELECT firm_id FROM users WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Inbound emails: users see their own
CREATE POLICY "inbound_emails_read_own" ON inbound_emails
  FOR SELECT
  USING (user_id = auth.uid());

-- Inbound emails: firm admins see all firm emails
CREATE POLICY "inbound_emails_read_firm_admin" ON inbound_emails
  FOR SELECT
  USING (
    firm_id = (SELECT firm_id FROM users WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Deals: add user_id-based policy (supplements existing firm_id policy)
-- Users see their own deals
CREATE POLICY "deals_read_own_user" ON deals
  FOR SELECT
  USING (user_id = auth.uid());

-- Firm admins see all firm deals (existing policy likely covers this,
-- but adding explicitly for completeness)
CREATE POLICY "deals_read_firm_admin" ON deals
  FOR SELECT
  USING (
    firm_id = (SELECT firm_id FROM users WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- 5. SERVICE ROLE ACCESS (for the API server)
-- ---------------------------------------------------------------------------
-- The API server uses the Supabase service role key, which bypasses RLS.
-- No additional policies needed for server-side operations.

-- ---------------------------------------------------------------------------
-- DONE
-- ---------------------------------------------------------------------------
