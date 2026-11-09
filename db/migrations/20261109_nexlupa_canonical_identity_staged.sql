-- NexLupa TTP240: CANONICAL family/identity schema PROPOSAL.
-- This migration is STAGED in a feature branch, NOT approved for Neon.
-- GitHub Actions runs it ONLY on an ephemeral PostgreSQL 17 CI database.
-- Real IdP validation, encryption/privacy review, role credentials,
-- deployment rollback, and family onboarding still require approval.
\set ON_ERROR_STOP on

CREATE TABLE public.nex_users (
  user_id text PRIMARY KEY CHECK (user_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  disabled_at timestamptz
);
CREATE TABLE public.nex_families (
  family_id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  archived_at timestamptz
);
CREATE TABLE public.nex_idp_identity_links (
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 9 AND 512
    AND issuer LIKE 'https://%'),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 256),
  user_id text NOT NULL REFERENCES public.nex_users(user_id),
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  PRIMARY KEY (issuer,subject)
);
CREATE INDEX nex_identity_links_user ON public.nex_idp_identity_links(user_id);
CREATE TABLE public.nex_family_memberships (
  user_id text NOT NULL REFERENCES public.nex_users(user_id),
  family_id uuid NOT NULL REFERENCES public.nex_families(family_id),
  role text NOT NULL CHECK (role IN ('owner','admin','member')),
  status text NOT NULL CHECK (status IN ('active','suspended')),
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id,family_id)
);
CREATE INDEX nex_family_memberships_family ON public.nex_family_memberships(family_id);

-- Never grant browser/public users table access or operational SQL execution.
REVOKE ALL ON TABLE public.nex_users FROM PUBLIC;
REVOKE ALL ON TABLE public.nex_families FROM PUBLIC;
REVOKE ALL ON TABLE public.nex_idp_identity_links FROM PUBLIC;
REVOKE ALL ON TABLE public.nex_family_memberships FROM PUBLIC;

ALTER TABLE public.nex_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nex_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_families FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nex_idp_identity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_idp_identity_links FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nex_family_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nex_family_memberships FORCE ROW LEVEL SECURITY;

-- In CI these are NOLOGIN roles. An actual runtime would need reviewed,
-- separately provisioned credentials and restricted login privileges.
CREATE ROLE nex_ci_canonical_identity_runtime
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE nex_ci_canonical_identity_owner
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public
  TO nex_ci_canonical_identity_runtime,nex_ci_canonical_identity_owner;
GRANT SELECT ON public.nex_users,public.nex_families,
  public.nex_idp_identity_links,public.nex_family_memberships
  TO nex_ci_canonical_identity_owner;

CREATE POLICY nex_ci_identity_owner_users_read
  ON public.nex_users FOR SELECT TO nex_ci_canonical_identity_owner
  USING (true);
CREATE POLICY nex_ci_identity_owner_families_read
  ON public.nex_families FOR SELECT TO nex_ci_canonical_identity_owner
  USING (true);
CREATE POLICY nex_ci_identity_owner_links_read
  ON public.nex_idp_identity_links FOR SELECT TO nex_ci_canonical_identity_owner
  USING (true);
CREATE POLICY nex_ci_identity_owner_members_read
  ON public.nex_family_memberships FOR SELECT TO nex_ci_canonical_identity_owner
  USING (true);

-- Only a trusted backend, after its REAL IdP has checked signature/session,
-- should call this function with the VERIFIED issuer and subject.
-- Knowledge of an issuer+subject is not itself an authentication proof.
CREATE FUNCTION public.nex_ci_resolve_verified_identity(
  p_issuer text,p_subject text
)
RETURNS TABLE(user_id text) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $body$
BEGIN
  IF p_issuer IS NULL OR length(p_issuer)<9 OR length(p_issuer)>512
     OR p_issuer NOT LIKE 'https://%'
     OR p_subject IS NULL OR length(p_subject)<1
     OR length(p_subject)>256 THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT u.user_id
    FROM public.nex_idp_identity_links i
    JOIN public.nex_users u ON u.user_id=i.user_id
    WHERE i.issuer=p_issuer AND i.subject=p_subject
      AND i.revoked_at IS NULL AND u.disabled_at IS NULL;
END;
$body$;
ALTER FUNCTION public.nex_ci_resolve_verified_identity(text,text)
  OWNER TO nex_ci_canonical_identity_owner;
REVOKE ALL ON FUNCTION
  public.nex_ci_resolve_verified_identity(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.nex_ci_resolve_verified_identity(text,text)
  TO nex_ci_canonical_identity_runtime;

-- Return no record for disabled users, archived families,
-- suspended memberships or revoked memberships.
CREATE FUNCTION public.nex_ci_active_family_membership(
  p_user text,p_family uuid
)
RETURNS TABLE(user_id text,family_id uuid,role text,
              active boolean,revoked boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $body$
BEGIN
  IF p_user IS NULL OR p_user !~ '^[A-Za-z0-9_-]{1,128}$'
    OR p_family IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT m.user_id,m.family_id,m.role,TRUE,FALSE
    FROM public.nex_family_memberships m
    JOIN public.nex_users u ON u.user_id=m.user_id
    JOIN public.nex_families f ON f.family_id=m.family_id
    WHERE m.user_id=p_user AND m.family_id=p_family
      AND m.status='active' AND m.revoked_at IS NULL
      AND u.disabled_at IS NULL AND f.archived_at IS NULL;
END;
$body$;
ALTER FUNCTION public.nex_ci_active_family_membership(text,uuid)
  OWNER TO nex_ci_canonical_identity_owner;
REVOKE ALL ON FUNCTION
  public.nex_ci_active_family_membership(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.nex_ci_active_family_membership(text,uuid)
  TO nex_ci_canonical_identity_runtime;

-- Read-and-row-lock authorization for operations such as sender enrollment.
-- The function owner only obtains UPDATE on non-sensitive updated_at for
-- PostgreSQL SELECT ... FOR SHARE row locking; it cannot change role/status.
GRANT UPDATE(updated_at) ON public.nex_family_memberships
  TO nex_ci_canonical_identity_owner;
CREATE POLICY nex_ci_identity_owner_members_lock
  ON public.nex_family_memberships FOR UPDATE
  TO nex_ci_canonical_identity_owner
  USING (status='active' AND revoked_at IS NULL)
  WITH CHECK (status='active' AND revoked_at IS NULL);

CREATE FUNCTION public.nex_ci_authorize_canonical_family_locked(
  p_user text,p_family uuid,p_action text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $body$
DECLARE selected_role text;
BEGIN
  IF p_user IS NULL OR p_user !~ '^[A-Za-z0-9_-]{1,128}$'
    OR p_family IS NULL OR p_action IS NULL OR
    p_action NOT IN ('enroll_whatsapp_sender',
                    'revoke_whatsapp_consent',
                    'read_whatsapp_messages')
  THEN RETURN FALSE; END IF;
  SELECT m.role INTO selected_role
    FROM public.nex_family_memberships m
    JOIN public.nex_users u ON u.user_id=m.user_id
    JOIN public.nex_families f ON f.family_id=m.family_id
    WHERE m.user_id=p_user AND m.family_id=p_family
      AND m.status='active' AND m.revoked_at IS NULL
      AND u.disabled_at IS NULL AND f.archived_at IS NULL
    FOR SHARE OF m;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF p_action='read_whatsapp_messages' THEN
    RETURN selected_role IN ('owner','admin','member');
  END IF;
  RETURN selected_role IN ('owner','admin');
END;
$body$;
ALTER FUNCTION public.nex_ci_authorize_canonical_family_locked(text,uuid,text)
  OWNER TO nex_ci_canonical_identity_owner;
REVOKE ALL ON FUNCTION
  public.nex_ci_authorize_canonical_family_locked(text,uuid,text)
  FROM PUBLIC;
-- No EXECUTE granted to the ordinary canonical lookup runtime.
-- Only a reviewed trusted operation owner may call this function.

-- No automatically registered users, identities, families or memberships.
-- A trusted, audited onboarding/identity-link lifecycle is still required.
SELECT 'TTP240 canonical schema staged on disposable PostgreSQL only' AS result;
