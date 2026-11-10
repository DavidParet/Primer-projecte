# NexLupa WhatsApp — TTP 224: identity source audit and membership adapter

## Current findings

Read-only checks on the separate Neon WhatsApp validation branch found no authoritative `users`, `families` or `family_memberships` identity tables. The GitHub default branch search likewise did not reveal a current family membership model. These checks do not prove the project has no identity service elsewhere; they show there is no safely identifiable one in the inspected integration surfaces.

## Staged in the isolated PR branch

- `lib/whatsapp/membership-store.js`: read-only parameterized lookup for a **proposed** `public.nex_family_memberships` table. The table is not created by this task.
- `tests/whatsapp-membership-store.test.js`: verifies narrow SQL parameters, revoked/mismatched memberships, duplicate identities, missing identity, and integration with `createFamilyAuthorizer`.
- The adapter must run under a restricted server-side role. `userId` must come only from a verified server session; request-body identity is not proof.

## Release blockers

1. Identify the real identity provider and its verified server-side session API.
2. Define/approve the actual family membership schema, primary keys, uniqueness and revocation semantics.
3. Create/review the dedicated membership-reading service role, grants and RLS.
4. Prove an attacker cannot change the authenticated user or membership while a consent mutation is underway. The existing membership check is not an atomic permission guarantee.
5. Integrate trusted identity into the consent-revocation route and test with separate accounts and different families.
6. No production activation or Neon DDL until independently verified.

## Security note

An unrelated GitHub default-branch configuration search produced text that appears to contain an authorization credential. Its validity is unknown and it was **not** reproduced or used. The repository maintainer should promptly review tracked configuration and rotate any credential that is still active. Deleting a file later will not remove a secret from Git history.
