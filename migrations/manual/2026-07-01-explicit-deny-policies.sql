-- 2026-07-01 — Explicit deny-all RLS policies on 18 public tables.
--
-- Context:
--   PR-N (2026-07-01-enable-rls-error-tables.sql) enabled RLS on the 9
--   tables the Supabase advisor had flagged as ERROR. The advisor then
--   downgraded all 9 to INFO-level rls_enabled_no_policy — joining another
--   9 tables that were already in the same "RLS on, no policies" state.
--
--   With RLS on and no policies, non-service_role Postgres roles (anon,
--   authenticated) get an implicit deny on every row. Behaviour is correct.
--   But the advisor keeps listing all 18 as INFO findings, and the intent
--   is not obvious to a reviewer skimming the schema.
--
--   This migration adds an explicit `USING (false)` policy per table for
--   the `anon` and `authenticated` roles. Same net effect as no policy at
--   all (implicit deny → explicit deny), but:
--     - clears the INFO advisories
--     - makes the "server-side-only via service_role" intent grep-able
--     - documents to any future reviewer that the empty-policy state is
--       deliberate, not an oversight
--
-- Why not FOR ALL / PUBLIC:
--   `service_role` is a Postgres BYPASSRLS role, so the policy never runs
--   for it and app behaviour is unchanged. Naming `anon, authenticated`
--   explicitly is louder about who this denies.
--
-- Rollback: DROP POLICY "<name>" ON public.<table>; per table.

-- ── 9 tables from PR-N (verified user data) ──
CREATE POLICY "deny_anon_and_authenticated"
  ON public.homeowner_sessions
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_and_authenticated"
  ON public.verification_access_requests
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_and_authenticated"
  ON public.verification_access_blocks
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_and_authenticated"
  ON public.resend_webhook_log
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_and_authenticated"
  ON public.homeowner_interest
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_and_authenticated"
  ON public.tradesman_verifications
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_and_authenticated"
  ON public.founding_pro_invites
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_and_authenticated"
  ON public.founding_pro_messages
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_and_authenticated"
  ON public.founding_pro_issues
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── 9 tables that already had RLS on but no policies (auth + partners + email) ──
CREATE POLICY "deny_anon_and_authenticated"
  ON public.email_log
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_and_authenticated"
  ON public.magic_link_tokens
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_and_authenticated"
  ON public.sessions
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_and_authenticated"
  ON public.partners
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_and_authenticated"
  ON public.partner_placements
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_and_authenticated"
  ON public.partner_events
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_and_authenticated"
  ON public.partner_enquiries
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_and_authenticated"
  ON public.partner_invoices
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_anon_and_authenticated"
  ON public.payments_log
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
