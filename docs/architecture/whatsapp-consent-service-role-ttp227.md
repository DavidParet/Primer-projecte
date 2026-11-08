# NexLupa WhatsApp — TTP 227: role-scoped revocation, PostgreSQL-only

## Objective

Test whether a separate `NOBYPASSRLS`, non-owner database role can perform the existing atomic consent revocation while having no access to unrelated NexLupa or Resend tables. No changes have been made in Neon.

## Implementation under test

The disposable GitHub Actions PostgreSQL database provisions synthetic `nex_ci_consent_revoker` and grants:
- `USAGE` on the test schema;
- `SELECT` and `UPDATE(revoked_at)` on WhatsApp consent rows;
- `SELECT` and `DELETE` on inbound WhatsApp messages;
- `SELECT` and narrowly scoped `UPDATE(updated_at)` on the synthetic family membership table, because PostgreSQL's `SELECT ... FOR SHARE` requires applicable UPDATE permissions and UPDATE RLS policies.

RLS policies restrict the role to the necessary operations but are **service-scoped**, not independently family-scoped. The transaction must execute trusted server-side session/membership validation and exact binding predicates before modifying consent. The test uses only synthetic identities and messages.

## Important authorization gap

This is **not yet a production-ready least-privilege design**. In order to permit `SELECT ... FOR SHARE` directly with RLS, the service account can technically update the membership row's `updated_at` field. Although this does not grant changes to `family_id`, `role`, `status` or `revoked_at`, unnecessary mutation privileges should be avoided in the live system.

Safer production options to evaluate: a carefully audited SECURITY DEFINER function that owns row-locking and checks a verified backend principal, or a consistent transaction advisory-lock protocol shared by all membership mutations. Both must be tested with genuine restricted service connections. Direct app role grants and broad service RLS predicates are not approved for Neon.

Another limitation: an external IdP session revocation cannot be made atomically consistent with a PostgreSQL transaction without a designed coordination protocol.

## Release gates

1. Identify the real IdP, memberships data source and family administrator semantics.
2. Eliminate the ability of the revocation runtime to modify membership metadata while still preventing authorization races.
3. Ensure the role cannot directly perform cross-family mutations without an authenticated server authorization boundary.
4. Validate actual SQL operations including `UPDATE ... RETURNING`, `DELETE`, rollback, and an unauthorized family request against the chosen roles/RLS.
5. Apply nothing to Neon until separately approved; keep the existing WhatsApp and Resend integrations disabled or unchanged.

The possible Vercel token in version-controlled settings remains a separate security incident requiring credential revocation verification.
