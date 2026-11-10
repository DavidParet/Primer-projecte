# NexLupa — TTP 225: identity readiness and potential credential leak

## Security incident: Vercel-like token in tracked repository config

A read-only GitHub code search found a string resembling a Vercel bearer token in a tracked local settings file on the repository's default branch. Validity was **not** tested. Do not reuse, log, paste, or commit the candidate token. Treat as exposed until verified revoked.

**Owner actions, separate from application deployment**:
1. Review Vercel account/team tokens using the official Vercel security/settings UI. Revoke the identified token if it exists. If it has already been revoked, document only the revocation date and token label (not the token).
2. Audit recent token activity, account/team access and deployments for unexpected changes. Escalate suspicious activity.
3. Remove any embedded credentials from the tracked file and guard such files in Git ignore rules. Preserve non-secret development configuration.
4. Review Git history and consider coordinated history sanitization if needed. Removing the current file alone does **not** remove historical exposure.
5. Replace the secret through the approved secret store only where a live integration truly requires it. Prefer scoped, short-lived credentials and least privileges.
6. Run GitHub secret scanning and add a CI denylist/scanner gate to catch new exposures.

No token was displayed or tested, and none has been revoked by this prototype work.

## Family identity: what is demonstrably missing

The inspected Neon isolated WhatsApp branch has no deployed authoritative family membership table or login provider recognized by this PR. A server-side authorization adapter and parameterized lookup exist but must not be treated as integrated production authentication.

The new `tests/sql/whatsapp-family-membership-contract.sql` is deliberately disposable PostgreSQL-only. It tests unique (user,family) mapping, membership roles, suspended/revoked memberships, and a restricted read role. It is **not** an approved Neon schema. Its internal role is allowed to inspect all membership rows for testing; a production service must use strict application auth, minimally scoped access, and careful audit design.

## Release blockers

- Establish which IdP supplies verifiable server-side sessions and the canonical family membership store.
- Enforce membership revocation atomically with privileged consent operations; current callback before transaction is insufficient against time-of-check/time-of-use races.
- Test an actual restricted service role and tenant isolation on a separate Neon branch only after explicit permission to modify database roles/policies.
- Verify credential rotation and accidental exposure controls before any production launch.

Production, Neon, Meta webhook and Resend were not modified by this TTP.
