-- 2026-07-01 — Enable Row-Level Security on 9 public tables flagged by the
-- Supabase advisor (lint 0013_rls_disabled_in_public).
--
-- Context:
--   Supabase's security advisor (get_advisors) flagged 9 public-schema tables
--   as ERROR-level because RLS was not enabled. Any client holding the
--   project's anon publishable key could hit PostgREST and read/write these
--   tables without going through our server.
--
--   TradesmanFinder's application-layer connection uses DATABASE_URL (a
--   service-role Postgres connection which bypasses RLS entirely), and the
--   client bundle never uses the anon key (no VITE_SUPABASE_* env vars are
--   exported to the client — confirmed 2026-07-01). This migration therefore
--   matches the posture already documented in shared/schema.ts for
--   magic_link_tokens / sessions / partners:
--
--       "RLS enabled, no policies. App uses service-role DATABASE_URL
--        connection; the anon browser key is never used for these tables."
--
--   With RLS on and no policies, the anon role gets an implicit deny on every
--   row; service_role continues to bypass RLS unchanged. Net effect on the
--   app is zero. Net effect on the anon-key exposure surface is removing all
--   nine tables from it.
--
-- Tables covered (all ERROR-level in the 2026-06-28 advisor run):
--   1. homeowner_sessions
--   2. verification_access_requests
--   3. verification_access_blocks
--   4. resend_webhook_log
--   5. homeowner_interest
--   6. tradesman_verifications
--   7. founding_pro_invites
--   8. founding_pro_messages
--   9. founding_pro_issues
--
-- Not covered by this migration (the advisor also flagged nine tables as
-- INFO — "RLS enabled but no policies"). Those are already in the correct
-- posture; the INFO lint is intentionally accepted by design.
--
-- Rollback: `ALTER TABLE public.<name> DISABLE ROW LEVEL SECURITY;` per table.
-- Rolling back returns the tables to the pre-migration exposure — not
-- recommended.

ALTER TABLE public.homeowner_sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_access_blocks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resend_webhook_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homeowner_interest           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tradesman_verifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.founding_pro_invites         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.founding_pro_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.founding_pro_issues          ENABLE ROW LEVEL SECURITY;
