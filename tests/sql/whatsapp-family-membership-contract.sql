-- NexLupa family identity — synthetic proof-of-concept, disposable PostgreSQL ONLY.
-- Not deployed to Neon. Do not treat this schema as an approved identity provider.
\set ON_ERROR_STOP on

CREATE TABLE nex_ci_family_memberships (
  user_id text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 128),
  family_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','admin','member')),
  status text NOT NULL CHECK (status IN ('active','suspended')),
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, family_id)
);

CREATE ROLE nex_ci_membership_reader NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO nex_ci_membership_reader;
GRANT SELECT ON nex_ci_family_memberships TO nex_ci_membership_reader;

-- Membership reader is a dedicated trusted backend identity service role:
-- database-user-controlled role mapping is used here solely for isolated tests.
-- Do NOT grant this role or its credentials to browsers or clients.
ALTER TABLE nex_ci_family_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE nex_ci_family_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY nex_ci_membership_read_policy ON nex_ci_family_memberships
 FOR SELECT TO nex_ci_membership_reader USING (true);

INSERT INTO nex_ci_family_memberships(user_id,family_id,role,status,revoked_at)
VALUES
('account-a','11111111-1111-4111-8111-111111111111','admin','active',null),
('account-b','22222222-2222-4222-8222-222222222222','member','active',null),
('account-c','33333333-3333-4333-8333-333333333333','owner','suspended',null),
('account-d','44444444-4444-4444-8444-444444444444','admin','active',now());

SET ROLE nex_ci_membership_reader;
DO $$
DECLARE n integer;
BEGIN
  SELECT COUNT(*) INTO n FROM nex_ci_family_memberships
  WHERE user_id='account-a'
    AND family_id='11111111-1111-4111-8111-111111111111'
    AND status='active' AND revoked_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'valid membership not visible'; END IF;

  SELECT COUNT(*) INTO n FROM nex_ci_family_memberships
  WHERE user_id='account-a'
    AND family_id='22222222-2222-4222-8222-222222222222'
    AND status='active' AND revoked_at IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'cross-family membership incorrectly accepted'; END IF;

  SELECT COUNT(*) INTO n FROM nex_ci_family_memberships
  WHERE user_id='account-c' AND status='active' AND revoked_at IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'suspended membership authorized'; END IF;

  SELECT COUNT(*) INTO n FROM nex_ci_family_memberships
  WHERE user_id='account-d' AND status='active' AND revoked_at IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'revoked membership authorized'; END IF;

  IF has_table_privilege(current_user,'nex_ci_family_memberships','INSERT')
   OR has_table_privilege(current_user,'nex_ci_family_memberships','UPDATE')
   OR has_table_privilege(current_user,'nex_ci_family_memberships','DELETE')
  THEN RAISE EXCEPTION 'read-only membership role has write grants'; END IF;
END $$;
RESET ROLE;

-- Only a trusted test owner mutates membership, not client-facing read role.
UPDATE nex_ci_family_memberships
SET status='suspended', updated_at=now()
WHERE user_id='account-a' AND family_id='11111111-1111-4111-8111-111111111111';

SET ROLE nex_ci_membership_reader;
DO $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM nex_ci_family_memberships WHERE
  user_id='account-a' AND family_id='11111111-1111-4111-8111-111111111111'
  AND status='active' AND revoked_at IS NULL
 ) THEN RAISE EXCEPTION 'membership suspension did not take effect'; END IF;
END $$;
RESET ROLE;
SELECT 'synthetic membership role and revocation contract passed' AS result;
