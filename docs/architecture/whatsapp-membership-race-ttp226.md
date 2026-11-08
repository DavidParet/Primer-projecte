# NexLupa — TTP 226: consent revocation and transactional membership lock

## Code change

The internal `createConsentRevoker` now **requires** two independent trusted checks:
1. `authorizeFamily({familyId,action})` rejects unknown families before opening a DB transaction. This early check is not sufficient for authorization.
2. `authorizeFamilyTransaction({client,familyId,action})` must verify the CURRENT authenticated server identity and active membership on the **same PostgreSQL client**, inside the transaction, before any `UPDATE` or `DELETE`.

The new prototype `createTransactionalFamilyAuthorizer` uses a parameterized membership query with `FOR SHARE` to retain a row lock until transaction commit or rollback. It rejects stale, missing, revoked, suspended or unauthorized memberships.

Unit tests cover revoked membership between initial and transactional authorization, missing privileged callback, SQL failures and rollback. Disposable PostgreSQL CI tests demonstrate a concurrent membership `UPDATE` cannot overtake an ongoing `FOR SHARE` authorization, and proceeds after the first transaction completes.

## Critical deployment prerequisites

- `public.nex_family_memberships` is still **hypothetical**; it has not been created in Neon.
- Production session verification is not connected. Server-supplied session data must be verified by a trusted IdP and securely bound to the current request. Do not accept user identity from a request body.
- The running role needs permission to perform `SELECT ... FOR SHARE`, subject to PostgreSQL's row-lock privilege requirements, while **not** becoming owner or gaining BYPASSRLS. Verify the exact grants/permissions and RLS in a restricted-role integration test before deployment.
- Any change to a membership must follow the same locking protocol. Disabling or deleting an account elsewhere without participation in this protocol requires a separate review; session revocation in external identity services cannot be made transactional with PostgreSQL by this prototype.
- Do not treat a preliminary `authorizeFamily` success as final authorization.
- A `FOR SHARE` lock orders transactions but cannot preempt an already committed operation. It ensures the permission check and consent mutation observe a consistent row until commit, not that any action completed before the revoke is retroactively undone.
- Consent transaction service role and production message ingestion must get separately reviewed grants/RLS; enabling FORCE RLS without planning service policies may break other operations.

No Meta API activation, Neon migration, real families, production jobs or public endpoint have been changed.
