-- TTP240: canonical identity & family RLS contracts in disposable PG17 only.
-- Run AFTER staged canonical identity schema; never against real Neon.
\set ON_ERROR_STOP on

INSERT INTO public.nex_users(user_id,disabled_at) VALUES
 ('canonical-a',NULL),('canonical-b',NULL),
 ('canonical-disabled',clock_timestamp()),('canonical-revoked',NULL);

INSERT INTO public.nex_families(family_id,display_name,archived_at) VALUES
 ('11111111-1111-4111-8111-111111111111','CI Family A',NULL),
 ('22222222-2222-4222-8222-222222222222','CI Family B',NULL),
 ('33333333-3333-4333-8333-333333333333','CI Archived Family',clock_timestamp()),
 ('44444444-4444-4444-8444-444444444444','CI Suspended Family',NULL);

INSERT INTO public.nex_idp_identity_links(issuer,subject,user_id,revoked_at)
VALUES
 ('https://idp.example.test','shared-external-subject','canonical-a',NULL),
 ('https://second-idp.example.test','shared-external-subject','canonical-b',NULL),
 ('https://idp.example.test','disabled-subject','canonical-disabled',NULL),
 ('https://idp.example.test','revoked-subject','canonical-revoked',clock_timestamp());

INSERT INTO public.nex_family_memberships(user_id,family_id,role,status,revoked_at)
VALUES
 ('canonical-a','11111111-1111-4111-8111-111111111111','owner','active',NULL),
 ('canonical-b','22222222-2222-4222-8222-222222222222','owner','active',NULL),
 ('canonical-b','11111111-1111-4111-8111-111111111111','member','active',NULL),
 ('canonical-disabled','11111111-1111-4111-8111-111111111111','admin','active',NULL),
 ('canonical-a','33333333-3333-4333-8333-333333333333','admin','active',NULL),
 ('canonical-b','44444444-4444-4444-8444-444444444444','admin','suspended',NULL),
 ('canonical-revoked','22222222-2222-4222-8222-222222222222','member','active',NULL);

DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_class c
 WHERE c.oid IN (
  'public.nex_users'::regclass,
  'public.nex_families'::regclass,
  'public.nex_idp_identity_links'::regclass,
  'public.nex_family_memberships'::regclass
 ) AND c.relrowsecurity AND c.relforcerowsecurity;
 IF n<>4 THEN RAISE EXCEPTION 'Not all canonical identity tables FORCE RLS'; END IF;
 IF EXISTS (
  SELECT 1 FROM pg_roles
  WHERE rolname IN ('nex_ci_canonical_identity_runtime',
    'nex_ci_canonical_identity_owner')
  AND (rolcanlogin OR rolbypassrls OR rolsuper)
 ) THEN RAISE EXCEPTION 'Canonical identity role has elevated rights'; END IF;
END $$;

SET ROLE nex_ci_canonical_identity_runtime;
DO $$
BEGIN
 IF has_table_privilege(current_user,'public.nex_users','SELECT')
 OR has_table_privilege(current_user,'public.nex_families','SELECT')
 OR has_table_privilege(current_user,'public.nex_idp_identity_links','SELECT')
 OR has_table_privilege(current_user,'public.nex_idp_identity_links','INSERT')
 OR has_table_privilege(current_user,'public.nex_family_memberships','SELECT')
 OR has_table_privilege(current_user,'public.nex_family_memberships','UPDATE')
 OR has_table_privilege(current_user,'public.nex_family_memberships','DELETE')
 THEN RAISE EXCEPTION 'Runtime could bypass canonical identity lookups'; END IF;
 BEGIN
  PERFORM 1 FROM public.nex_idp_identity_links;
  RAISE EXCEPTION 'Runtime could read raw linked identities';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- The same provider subject means different accounts with different issuers.
SELECT (SELECT user_id FROM public.nex_ci_resolve_verified_identity(
 'https://idp.example.test','shared-external-subject')
)='canonical-a' AS first_issuer_ok \gset
\if :first_issuer_ok
\else
 \echo 'First issuer mapping rejected or confused'
 \quit 1
\endif

SELECT (SELECT user_id FROM public.nex_ci_resolve_verified_identity(
 'https://second-idp.example.test','shared-external-subject')
)='canonical-b' AS second_issuer_ok \gset
\if :second_issuer_ok
\else
 \echo 'Second issuer identity mapping mismatch'
 \quit 1
\endif

SELECT NOT EXISTS (SELECT 1 FROM public.nex_ci_resolve_verified_identity(
 'https://idp.example.test','disabled-subject')) AS disabled_denied \gset
\if :disabled_denied
\else
 \echo 'Disabled account was allowed to authenticate'
 \quit 1
\endif

SELECT NOT EXISTS (SELECT 1 FROM public.nex_ci_resolve_verified_identity(
 'https://idp.example.test','revoked-subject')) AS revoked_denied \gset
\if :revoked_denied
\else
 \echo 'Revoked provider link was allowed to authenticate'
 \quit 1
\endif

SELECT NOT EXISTS (SELECT 1 FROM public.nex_ci_resolve_verified_identity(
 'https://untrusted.example.test','shared-external-subject')) AS unknown_denied \gset
\if :unknown_denied
\else
 \echo 'Unknown provider issuer was accepted'
 \quit 1
\endif

SELECT (
 SELECT role FROM public.nex_ci_active_family_membership(
  'canonical-a','11111111-1111-4111-8111-111111111111')
)='owner' AS a_owner \gset
\if :a_owner
\else
 \echo 'Family A owner is missing'
 \quit 1
\endif

SELECT (
 SELECT role FROM public.nex_ci_active_family_membership(
  'canonical-b','11111111-1111-4111-8111-111111111111')
)='member' AS b_member \gset
\if :b_member
\else
 \echo 'Second user cross-membership incorrectly granted admin role'
 \quit 1
\endif

SELECT NOT EXISTS(SELECT 1 FROM public.nex_ci_active_family_membership(
 'canonical-disabled','11111111-1111-4111-8111-111111111111')
) AS inactive_denied \gset
\if :inactive_denied
\else
 \echo 'Disabled owner allowed to access family'
 \quit 1
\endif

SELECT NOT EXISTS(SELECT 1 FROM public.nex_ci_active_family_membership(
 'canonical-a','33333333-3333-4333-8333-333333333333')
) AS archived_denied \gset
\if :archived_denied
\else
 \echo 'Archived family access unexpectedly granted'
 \quit 1
\endif

SELECT NOT EXISTS(SELECT 1 FROM public.nex_ci_active_family_membership(
 'canonical-b','44444444-4444-4444-8444-444444444444')
) AS suspended_denied \gset
\if :suspended_denied
\else
 \echo 'Suspended family membership was accepted'
 \quit 1
\endif

SELECT NOT EXISTS(SELECT 1 FROM public.nex_ci_active_family_membership(
 'canonical-a','22222222-2222-4222-8222-222222222222')
) AS cross_family_denied \gset
\if :cross_family_denied
\else
 \echo 'Unrelated family membership was granted'
 \quit 1
\endif
RESET ROLE;

-- A trusted operator can revoke identity and membership; no runtime writes.
UPDATE public.nex_idp_identity_links SET revoked_at=clock_timestamp()
 WHERE issuer='https://idp.example.test'
 AND subject='shared-external-subject';
UPDATE public.nex_family_memberships
 SET revoked_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE user_id='canonical-b'
 AND family_id='11111111-1111-4111-8111-111111111111';

SET ROLE nex_ci_canonical_identity_runtime;
SELECT NOT EXISTS(SELECT 1 FROM public.nex_ci_resolve_verified_identity(
 'https://idp.example.test','shared-external-subject')
) AS revoked_mapping_denied \gset
\if :revoked_mapping_denied
\else
 \echo 'Recently revoked identity still authenticates'
 \quit 1
\endif
SELECT NOT EXISTS(SELECT 1 FROM public.nex_ci_active_family_membership(
 'canonical-b','11111111-1111-4111-8111-111111111111')
) AS revoked_membership_denied \gset
\if :revoked_membership_denied
\else
 \echo 'Recently revoked membership still authorizes'
 \quit 1
\endif
RESET ROLE;

SELECT 'TTP240 canonical identity and family RLS checks passed' AS result;
