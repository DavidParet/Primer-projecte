-- TTP 228. Disposable GitHub Actions PostgreSQL 17 ONLY, NEVER Neon.
-- Run after the TTP227 revocation smoke test (creates test-only roles/table).
\set ON_ERROR_STOP on

-- Remove the metadata write permission from the calling service.
REVOKE UPDATE (updated_at) ON public.nex_ci_family_memberships
  FROM nex_ci_consent_revoker;
REVOKE SELECT ON public.nex_ci_family_memberships
  FROM nex_ci_consent_revoker;
DROP POLICY nex_ci_consent_member_read ON public.nex_ci_family_memberships;
DROP POLICY nex_ci_consent_member_row_lock ON public.nex_ci_family_memberships;

-- A separate NOLOGIN function owner, not the application runtime or table
-- owner, receives the narrow PostgreSQL privileges required for FOR SHARE.
CREATE ROLE nex_ci_membership_lock_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO nex_ci_membership_lock_owner;
GRANT SELECT, UPDATE (updated_at) ON public.nex_ci_family_memberships
  TO nex_ci_membership_lock_owner;
CREATE POLICY nex_ci_locked_membership_select
 ON public.nex_ci_family_memberships FOR SELECT
 TO nex_ci_membership_lock_owner
 USING (status = 'active' AND revoked_at IS NULL);
CREATE POLICY nex_ci_locked_membership_update
 ON public.nex_ci_family_memberships FOR UPDATE
 TO nex_ci_membership_lock_owner
 USING (status = 'active' AND revoked_at IS NULL)
 WITH CHECK (status = 'active' AND revoked_at IS NULL);

-- Fixed search path, fully-qualified table, no dynamic SQL, no definer
-- parameter that can set the caller's database role. Permission to EXECUTE is
-- restricted to the backend revocation role, never PUBLIC or family roles.
CREATE FUNCTION public.nex_authorize_family_locked(
  p_user_id text, p_family_id uuid, p_action text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $func$
DECLARE v_role text;
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) < 1 OR length(p_user_id) > 128
     OR p_family_id IS NULL OR p_action IS NULL
     OR p_action NOT IN (
       'revoke_whatsapp_consent',
       'enroll_whatsapp_sender',
       'read_whatsapp_messages'
     ) THEN
    RETURN FALSE;
  END IF;
  SELECT m.role INTO v_role
  FROM public.nex_ci_family_memberships AS m
  WHERE m.user_id = p_user_id AND m.family_id = p_family_id
    AND m.status = 'active' AND m.revoked_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF p_action IN ('revoke_whatsapp_consent', 'enroll_whatsapp_sender') THEN
    RETURN v_role IN ('owner','admin');
  END IF;
  RETURN v_role IN ('owner','admin','member');
END;
$func$;
ALTER FUNCTION public.nex_authorize_family_locked(text,uuid,text)
 OWNER TO nex_ci_membership_lock_owner;
REVOKE ALL ON FUNCTION public.nex_authorize_family_locked(text,uuid,text)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nex_authorize_family_locked(text,uuid,text)
 TO nex_ci_consent_revoker;

-- TTP227 changed account-a to active. Verify actual client privilege state.
SET ROLE nex_ci_consent_revoker;
DO $$
DECLARE result boolean;
BEGIN
  IF has_table_privilege(current_user,'public.nex_ci_family_memberships','UPDATE')
     OR has_table_privilege(current_user,'public.nex_ci_family_memberships','SELECT')
     OR has_column_privilege(current_user,'public.nex_ci_family_memberships','updated_at','UPDATE')
     OR has_column_privilege(current_user,'public.nex_ci_family_memberships','status','UPDATE')
  THEN RAISE EXCEPTION 'Runtime has direct membership privileges'; END IF;

  -- An attempted direct membership mutation must be denied even on a
  -- legitimate, currently active member.
  BEGIN
    UPDATE public.nex_ci_family_memberships
      SET updated_at = now()
    WHERE user_id = 'account-a';
    RAISE EXCEPTION 'Unexpected membership mutation succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT public.nex_authorize_family_locked(
    'account-a', '11111111-1111-4111-8111-111111111111',
    'revoke_whatsapp_consent') INTO result;
  IF result IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Active admin denied by function'; END IF;

  SELECT public.nex_authorize_family_locked(
    'account-a', '22222222-2222-4222-8222-222222222222',
    'revoke_whatsapp_consent') INTO result;
  IF result IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'Forged family access granted'; END IF;

  SELECT public.nex_authorize_family_locked(
    'account-b', '22222222-2222-4222-8222-222222222222',
    'revoke_whatsapp_consent') INTO result;
  IF result IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'Suspended member allowed'; END IF;

  SELECT public.nex_authorize_family_locked(
    'account-a', '11111111-1111-4111-8111-111111111111',
    'unapproved_action') INTO result;
  IF result IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'Unknown operation allowed'; END IF;
END $$;
RESET ROLE;

-- Unrelated roles must not be able to invoke this elevated function.
SET ROLE whatsapp_ci_unauthorized;
DO $$
BEGIN
  BEGIN
    PERFORM public.nex_authorize_family_locked(
      'account-a','11111111-1111-4111-8111-111111111111',
      'revoke_whatsapp_consent');
    RAISE EXCEPTION 'Non-service caller invoked elevated function';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- The service can no longer change membership status through its credentials.
-- Function owner has no BYPASSRLS and no table ownership.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname='nex_ci_membership_lock_owner'
      AND (rolsuper OR rolbypassrls OR rolcanlogin)
  ) THEN RAISE EXCEPTION 'Function owner is privileged'; END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
    WHERE c.oid='public.nex_ci_family_memberships'::regclass
      AND r.rolname='nex_ci_membership_lock_owner'
  ) THEN RAISE EXCEPTION 'Function owner owns membership table'; END IF;
END $$;

SELECT 'TTP228 restricted service function security checks passed' AS result;
