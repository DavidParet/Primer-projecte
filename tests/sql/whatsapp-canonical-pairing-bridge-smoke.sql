-- NexLupa TTP245: bridge signed pairing DB path to CANONICAL family data.
-- CI POSTGRES 17 ONLY. Runs AFTER all earlier synthetic pairing tests AND
-- the canonical TTP240 identity schema fixture. NEVER execute on live Neon.
\set ON_ERROR_STOP on

-- The canonical read role may not turn a user ID it knows into a writable
-- family pairing. The lock function is reserved for an elevated owner.
SET ROLE nex_ci_canonical_identity_runtime;
DO $f$
BEGIN
 IF has_function_privilege(current_user,
  'public.nex_ci_authorize_canonical_family_locked(text,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Read-only IdP role can access canonical lock'; END IF;
 IF has_column_privilege(current_user,
  'public.nex_family_memberships','updated_at','UPDATE')
 THEN RAISE EXCEPTION 'Read-only IdP role can lock/edit family membership'; END IF;
END;
$f$;
RESET ROLE;

-- TTP228's old test-only locked authorization reads
-- public.nex_ci_family_memberships. For the FINAL CI integration stage,
-- atomically change its definition to consult CANONICAL users, families and
-- memberships instead. Keep the same restricted owner and EXECUTE grants.
GRANT EXECUTE ON FUNCTION
 public.nex_ci_authorize_canonical_family_locked(text,uuid,text)
 TO nex_ci_membership_lock_owner;
CREATE OR REPLACE FUNCTION public.nex_authorize_family_locked(
 p_user_id text,p_family_id uuid,p_action text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $body$
BEGIN
 RETURN public.nex_ci_authorize_canonical_family_locked(
  p_user_id,p_family_id,p_action
 );
END;
$body$;

-- Direct invocation of either SQL authorization layer remains unavailable
-- to the issuer role, even after the new canonical bridge is installed.
SET ROLE nex_ci_pairing_issuer;
DO $f$
BEGIN
 IF has_function_privilege(current_user,
  'public.nex_authorize_family_locked(text,uuid,text)','EXECUTE')
 OR has_function_privilege(current_user,
  'public.nex_ci_authorize_canonical_family_locked(text,uuid,text)','EXECUTE')
 OR has_table_privilege(current_user,
  'public.nex_family_memberships','SELECT')
 THEN RAISE EXCEPTION 'Pairing runtime gained direct family access'; END IF;
END;
$f$;
RESET ROLE;

-- The legacy synthetic account-a was an admin of Family A in TTP228.
-- The CANONICAL schema does not contain that account. A signed operation
-- for this previously valid synthetic ID MUST now fail.
SELECT (floor(extract(epoch from clock_timestamp()))::bigint+55) AS old_exp,
 gen_random_uuid()::text AS old_nonce \gset
SELECT encode(public.hmac(convert_to(concat_ws('|',
 'NEXLUPA-PAIR-ISSUE-1','issue-key-v1','account-a',
 '11111111-1111-4111-8111-111111111111',
 '766661111','866661111',repeat('aa',32),
 :'old_exp',:'old_nonce'),'UTF8'),
 decode(repeat('e1',32),'hex'),'sha256'),'hex') AS old_sig \gset

SET ROLE nex_ci_pairing_issuer;
SELECT (public.nex_ci_signed_issue_whatsapp_pairing(
 'account-a','11111111-1111-4111-8111-111111111111',
 '766661111','866661111',decode(repeat('aa',32),'hex'),
 'issue-key-v1',:'old_exp',:'old_nonce'::uuid,
 decode(:'old_sig','hex'))->>'state'='rejected') AS legacy_denied \gset
\if :legacy_denied
\else
 \echo 'Legacy phantom family administrator was accepted'
 \quit 1
\endif
RESET ROLE;

-- canonical-b owns a real, active membership in Family B. A separately
-- signed 60-second permit can therefore issue one challenge.
SELECT (floor(extract(epoch from clock_timestamp()))::bigint+55) AS issue_exp,
 gen_random_uuid()::text AS issue_nonce \gset
SELECT encode(public.hmac(convert_to(concat_ws('|',
 'NEXLUPA-PAIR-ISSUE-1','issue-key-v1','canonical-b',
 '22222222-2222-4222-8222-222222222222',
 '766661111','866661111',repeat('ab',32),
 :'issue_exp',:'issue_nonce'),'UTF8'),
 decode(repeat('e1',32),'hex'),'sha256'),'hex') AS issue_sig \gset
SET ROLE nex_ci_pairing_issuer;
SELECT (public.nex_ci_signed_issue_whatsapp_pairing(
 'canonical-b','22222222-2222-4222-8222-222222222222',
 '766661111','866661111',decode(repeat('ab',32),'hex'),
 'issue-key-v1',:'issue_exp',:'issue_nonce'::uuid,
 decode(:'issue_sig','hex'))->>'state'='created') AS canonical_created \gset
\if :canonical_created
\else
 \echo 'Canonical family administrator could not issue signed pairing'
 \quit 1
\endif
RESET ROLE;

-- The sender sends a signed-Meta exact acceptance command upstream.
-- This PostgreSQL test receives only the already validated derived digests:
-- it checks the locked canonical owner BEFORE granting explicit consent.
SELECT (floor(extract(epoch from clock_timestamp()))::bigint+55) AS confirm_exp,
 gen_random_uuid()::text AS confirm_nonce \gset
SELECT encode(public.hmac(convert_to(concat_ws('|',
 'NEXLUPA-PAIR-CONFIRM-1','confirm-key-v1',
 '766661111','866661111',repeat('ab',32),repeat('ba',32),
 'wamid.ttp245-canonical',:'confirm_exp',:'confirm_nonce'),'UTF8'),
 decode(repeat('e2',32),'hex'),'sha256'),'hex') AS confirm_sig \gset
SET ROLE nex_ci_pairing_confirmer;
SELECT (public.nex_ci_signed_confirm_whatsapp_pairing(
 '766661111','866661111',decode(repeat('ab',32),'hex'),
 decode(repeat('ba',32),'hex'),'wamid.ttp245-canonical',
 'confirm-key-v1',:'confirm_exp',:'confirm_nonce'::uuid,
 decode(:'confirm_sig','hex'))->>'state'='paired') AS canonical_paired \gset
\if :canonical_paired
\else
 \echo 'Canonical family consent not committed after signed confirmation'
 \quit 1
\endif
RESET ROLE;

DO $f$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM public.nex_whatsapp_sender_authorizations
  WHERE family_id='22222222-2222-4222-8222-222222222222'
    AND business_account_id='766661111'
    AND phone_number_id='866661111'
    AND sender_digest=decode(repeat('ba',32),'hex')
    AND scope='incoming_text'
    AND consent_source='sender_whatsapp_explicit_opt_in'
    AND revoked_at IS NULL
 ) THEN RAISE EXCEPTION 'Active canonical family consent missing'; END IF;
 IF EXISTS(
  SELECT 1 FROM public.nex_whatsapp_sender_authorizations
  WHERE business_account_id='766661111' AND
        family_id<>'22222222-2222-4222-8222-222222222222'
 ) THEN RAISE EXCEPTION 'Cross-family consent inserted'; END IF;
END;
$f$;

-- Open one more challenge while the admin is valid but do not spend it yet.
-- It must become unusable if that administrator is later revoked.
SELECT (floor(extract(epoch from clock_timestamp()))::bigint+55) AS pending_exp,
 gen_random_uuid()::text AS pending_nonce \gset
SELECT encode(public.hmac(convert_to(concat_ws('|',
 'NEXLUPA-PAIR-ISSUE-1','issue-key-v1','canonical-b',
 '22222222-2222-4222-8222-222222222222',
 '766661111','866661111',repeat('ad',32),
 :'pending_exp',:'pending_nonce'),'UTF8'),
 decode(repeat('e1',32),'hex'),'sha256'),'hex') AS pending_sig \gset
SET ROLE nex_ci_pairing_issuer;
SELECT (public.nex_ci_signed_issue_whatsapp_pairing(
 'canonical-b','22222222-2222-4222-8222-222222222222',
 '766661111','866661111',decode(repeat('ad',32),'hex'),
 'issue-key-v1',:'pending_exp',:'pending_nonce'::uuid,
 decode(:'pending_sig','hex'))->>'state'='created') AS pending_created \gset
\if :pending_created
\else
 \echo 'Pending canonical challenge was not staged'
 \quit 1
\endif
RESET ROLE;

-- Revoking the actual canonical membership now prevents even a correctly
-- signed new invitation. The old synthetic role must not override it.
UPDATE public.nex_family_memberships
 SET revoked_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE user_id='canonical-b' AND
       family_id='22222222-2222-4222-8222-222222222222';

SELECT (floor(extract(epoch from clock_timestamp()))::bigint+55) AS revoked_exp,
 gen_random_uuid()::text AS revoked_nonce \gset
SELECT encode(public.hmac(convert_to(concat_ws('|',
 'NEXLUPA-PAIR-ISSUE-1','issue-key-v1','canonical-b',
 '22222222-2222-4222-8222-222222222222',
 '766661111','866661111',repeat('ac',32),
 :'revoked_exp',:'revoked_nonce'),'UTF8'),
 decode(repeat('e1',32),'hex'),'sha256'),'hex') AS revoked_sig \gset
SET ROLE nex_ci_pairing_issuer;
SELECT (public.nex_ci_signed_issue_whatsapp_pairing(
 'canonical-b','22222222-2222-4222-8222-222222222222',
 '766661111','866661111',decode(repeat('ac',32),'hex'),
 'issue-key-v1',:'revoked_exp',:'revoked_nonce'::uuid,
 decode(:'revoked_sig','hex'))->>'state'='rejected') AS revoked_denied \gset
\if :revoked_denied
\else
 \echo 'Revoked canonical owner still issued pairing'
 \quit 1
\endif
RESET ROLE;

-- A code issued BEFORE revocation does not survive an administrator
-- losing family rights. A correctly signed Meta-derived confirmation still
-- cannot enroll the sender once the canonical family membership is revoked.
SELECT (floor(extract(epoch from clock_timestamp()))::bigint+55) AS late_exp,
 gen_random_uuid()::text AS late_nonce \gset
SELECT encode(public.hmac(convert_to(concat_ws('|',
 'NEXLUPA-PAIR-CONFIRM-1','confirm-key-v1',
 '766661111','866661111',repeat('ad',32),repeat('bc',32),
 'wamid.ttp245-late',:'late_exp',:'late_nonce'),'UTF8'),
 decode(repeat('e2',32),'hex'),'sha256'),'hex') AS late_sig \gset
SET ROLE nex_ci_pairing_confirmer;
SELECT (public.nex_ci_signed_confirm_whatsapp_pairing(
 '766661111','866661111',decode(repeat('ad',32),'hex'),
 decode(repeat('bc',32),'hex'),'wamid.ttp245-late',
 'confirm-key-v1',:'late_exp',:'late_nonce'::uuid,
 decode(:'late_sig','hex'))->>'state'='rejected') AS late_denied \gset
\if :late_denied
\else
 \echo 'Revoked admin left a usable pending family pairing code'
 \quit 1
\endif
RESET ROLE;
DO $f$
BEGIN
 IF EXISTS(
  SELECT 1 FROM public.nex_whatsapp_sender_authorizations
  WHERE business_account_id='766661111'
    AND sender_digest=decode(repeat('bc',32),'hex')
 ) THEN RAISE EXCEPTION 'Rejected late sender received family consent'; END IF;
 IF EXISTS(
  SELECT 1 FROM public.nex_ci_whatsapp_pairing_receipts
  WHERE business_account_id='766661111'
    AND provider_message_id='wamid.ttp245-late'
 ) THEN RAISE EXCEPTION 'Rejected late confirmation received a receipt'; END IF;
END;
$f$;

SELECT 'TTP245 canonical family -> signed WhatsApp pairing bridge passed' AS result;
