-- NexLupa · signed inbound + inbox-read nonce retention (CI ONLY).
-- Disposable PostgreSQL 17. NEVER apply this file to Neon/production.
-- Must run after BOTH signed RPC migrations and their synthetic tests.
-- This test designs a separate maintenance role with a 5-minute grace
-- window. The real deployment needs a reviewed scheduler and credential.
\set ON_ERROR_STOP on

CREATE INDEX nex_ci_ingest_nonce_expire_idx
 ON public.nex_ci_inbound_ingest_nonces(expires_at,nonce);
CREATE INDEX nex_ci_read_nonce_expire_idx
 ON public.nex_ci_inbox_read_nonces(expires_at,nonce);

CREATE ROLE nex_ci_inbox_nonce_maintenance
 NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO nex_ci_inbox_nonce_maintenance;
GRANT SELECT,DELETE ON
 public.nex_ci_inbound_ingest_nonces,
 public.nex_ci_inbox_read_nonces
 TO nex_ci_inbox_nonce_maintenance;

CREATE POLICY nex_ci_ingest_nonce_maintenance_read
 ON public.nex_ci_inbound_ingest_nonces FOR SELECT
 TO nex_ci_inbox_nonce_maintenance
 USING(expires_at<clock_timestamp()-interval '5 minutes');
CREATE POLICY nex_ci_ingest_nonce_maintenance_delete
 ON public.nex_ci_inbound_ingest_nonces FOR DELETE
 TO nex_ci_inbox_nonce_maintenance
 USING(expires_at<clock_timestamp()-interval '5 minutes');
CREATE POLICY nex_ci_read_nonce_maintenance_read
 ON public.nex_ci_inbox_read_nonces FOR SELECT
 TO nex_ci_inbox_nonce_maintenance
 USING(expires_at<clock_timestamp()-interval '5 minutes');
CREATE POLICY nex_ci_read_nonce_maintenance_delete
 ON public.nex_ci_inbox_read_nonces FOR DELETE
 TO nex_ci_inbox_nonce_maintenance
 USING(expires_at<clock_timestamp()-interval '5 minutes');

-- These are all fabricated nonce identifiers. No real accounts or messages.
INSERT INTO public.nex_ci_inbound_ingest_nonces(nonce,expires_at)
VALUES
 ('aaaa0000-aaaa-4aaa-8aaa-000000000001',clock_timestamp()-interval '15 minutes'),
 ('aaaa0000-aaaa-4aaa-8aaa-000000000002',clock_timestamp()-interval '8 minutes'),
 ('aaaa0000-aaaa-4aaa-8aaa-000000000003',clock_timestamp()-interval '1 minute'),
 ('aaaa0000-aaaa-4aaa-8aaa-000000000004',clock_timestamp()+interval '1 minute');
INSERT INTO public.nex_ci_inbox_read_nonces(nonce,expires_at)
VALUES
 ('bbbb0000-bbbb-4bbb-8bbb-000000000001',clock_timestamp()-interval '15 minutes'),
 ('bbbb0000-bbbb-4bbb-8bbb-000000000002',clock_timestamp()-interval '8 minutes'),
 ('bbbb0000-bbbb-4bbb-8bbb-000000000003',clock_timestamp()-interval '1 minute'),
 ('bbbb0000-bbbb-4bbb-8bbb-000000000004',clock_timestamp()+interval '1 minute');

SET ROLE nex_ci_inbox_nonce_maintenance;
DO $check$
DECLARE ingest_visible integer;read_visible integer;
BEGIN
 IF has_table_privilege(current_user,
   'public.nex_ci_inbound_ingest_nonces','INSERT')
  OR has_table_privilege(current_user,
   'public.nex_ci_inbox_read_nonces','INSERT')
  OR has_table_privilege(current_user,
   'public.nex_ci_inbound_ingest_nonces','UPDATE')
  OR has_table_privilege(current_user,
   'public.nex_ci_inbox_read_nonces','UPDATE')
  OR has_table_privilege(current_user,
   'public.nex_ci_inbound_ingest_keys','SELECT')
  OR has_table_privilege(current_user,
   'public.nex_ci_inbox_read_keys','SELECT')
  OR has_table_privilege(current_user,
   'public.nex_whatsapp_inbound','SELECT')
  OR has_table_privilege(current_user,
   'public.nex_whatsapp_inbound','DELETE')
  OR has_function_privilege(current_user,
   'public.nex_ci_signed_store_whatsapp_inbound(text,text,bytea,text,bytea,bytea,bytea,bigint,text,bigint,uuid,bytea)',
   'EXECUTE')
  OR has_function_privilege(current_user,
   'public.nex_ci_signed_read_family_whatsapp_inbox(text,uuid,bytea,bigint,integer,text,bigint,uuid,bytea)',
   'EXECUTE')
 THEN RAISE EXCEPTION 'Nonce-only cleaner has excessive privileges'; END IF;
 SELECT count(*) INTO ingest_visible
  FROM public.nex_ci_inbound_ingest_nonces
  WHERE nonce::text LIKE 'aaaa0000-%';
 SELECT count(*) INTO read_visible
  FROM public.nex_ci_inbox_read_nonces
  WHERE nonce::text LIKE 'bbbb0000-%';
 IF ingest_visible<>2 OR read_visible<>2
 THEN RAISE EXCEPTION 'Cleanup RLS exposed recent nonces'; END IF;
END;
$check$;

-- Attempting to delete a recently expired nonce is always denied by RLS.
DELETE FROM public.nex_ci_inbound_ingest_nonces
 WHERE nonce='aaaa0000-aaaa-4aaa-8aaa-000000000003';
DELETE FROM public.nex_ci_inbox_read_nonces
 WHERE nonce='bbbb0000-bbbb-4bbb-8bbb-000000000003';

-- Bounded one-record batches, each with SQL-side grace recheck.
WITH candidates AS (
 SELECT nonce FROM public.nex_ci_inbound_ingest_nonces
 WHERE expires_at<clock_timestamp()-interval '5 minutes'
 ORDER BY expires_at,nonce LIMIT 1
)
DELETE FROM public.nex_ci_inbound_ingest_nonces AS ledger
USING candidates
WHERE ledger.nonce=candidates.nonce
 AND ledger.expires_at<clock_timestamp()-interval '5 minutes';

WITH candidates AS (
 SELECT nonce FROM public.nex_ci_inbox_read_nonces
 WHERE expires_at<clock_timestamp()-interval '5 minutes'
 ORDER BY expires_at,nonce LIMIT 1
)
DELETE FROM public.nex_ci_inbox_read_nonces AS ledger
USING candidates
WHERE ledger.nonce=candidates.nonce
 AND ledger.expires_at<clock_timestamp()-interval '5 minutes';

DO $check$
DECLARE ingest_visible integer;read_visible integer;
BEGIN
 SELECT count(*) INTO ingest_visible FROM public.nex_ci_inbound_ingest_nonces
  WHERE nonce::text LIKE 'aaaa0000-%';
 SELECT count(*) INTO read_visible FROM public.nex_ci_inbox_read_nonces
  WHERE nonce::text LIKE 'bbbb0000-%';
 IF ingest_visible<>1 OR read_visible<>1
 THEN RAISE EXCEPTION 'Bounded cleanup failed'; END IF;
END;
$check$;

-- Second batch clears the last eligible nonce in each protected ledger.
WITH candidates AS (
 SELECT nonce FROM public.nex_ci_inbound_ingest_nonces
 WHERE expires_at<clock_timestamp()-interval '5 minutes'
 ORDER BY expires_at,nonce LIMIT 1
)
DELETE FROM public.nex_ci_inbound_ingest_nonces AS ledger
USING candidates
WHERE ledger.nonce=candidates.nonce
 AND ledger.expires_at<clock_timestamp()-interval '5 minutes';
WITH candidates AS (
 SELECT nonce FROM public.nex_ci_inbox_read_nonces
 WHERE expires_at<clock_timestamp()-interval '5 minutes'
 ORDER BY expires_at,nonce LIMIT 1
)
DELETE FROM public.nex_ci_inbox_read_nonces AS ledger
USING candidates
WHERE ledger.nonce=candidates.nonce
 AND ledger.expires_at<clock_timestamp()-interval '5 minutes';
RESET ROLE;

DO $check$
BEGIN
 IF (SELECT count(*) FROM public.nex_ci_inbound_ingest_nonces
   WHERE nonce::text LIKE 'aaaa0000-%')<>2
 OR (SELECT count(*) FROM public.nex_ci_inbox_read_nonces
   WHERE nonce::text LIKE 'bbbb0000-%')<>2
 THEN RAISE EXCEPTION 'Cleanup deleted too many or too few nonces'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.nex_ci_inbound_ingest_nonces
   WHERE nonce='aaaa0000-aaaa-4aaa-8aaa-000000000003')
 OR NOT EXISTS(SELECT 1 FROM public.nex_ci_inbox_read_nonces
   WHERE nonce='bbbb0000-bbbb-4bbb-8bbb-000000000003')
 OR NOT EXISTS(SELECT 1 FROM public.nex_ci_inbound_ingest_nonces
   WHERE nonce='aaaa0000-aaaa-4aaa-8aaa-000000000004')
 OR NOT EXISTS(SELECT 1 FROM public.nex_ci_inbox_read_nonces
   WHERE nonce='bbbb0000-bbbb-4bbb-8bbb-000000000004')
 THEN RAISE EXCEPTION 'Recent unexpired nonce purged'; END IF;
END;
$check$;

SELECT 'CI: dual signed-inbox nonce expiry RLS maintenance passed' AS result;
