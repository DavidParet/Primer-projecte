# NexLupa — Scheduled WhatsApp retention: staged, NOT active

## Current status

- The schedule definition on the WhatsApp prototype branch is a **disabled safety check**. Even if merged into the default branch, its daily cron at 03:17 UTC performs **no database connection and no deletion**.
- `lib/whatsapp/retention-scheduler.js` defaults to `enabled=false`; it refuses active execution without a separate maintenance DB factory, monitored reporting, and a closable DB adapter.
- `lib/whatsapp/retention-worker.js` has bounded deletion queries, structured count-only reporting, and propagates errors. Its unit tests and separate disposable PostgreSQL tests cover retention behavior.
- **No Neon credentials, project IDs, connection strings, real sender IDs, or webhook changes are included in the scheduled workflow.**
- GitHub Actions workflows only run scheduled events from the default branch; the workflow is currently on the PR branch.

## Activation requirements (not implemented)

1. Approve a separate dedicated non-owner PostgreSQL maintenance role and minimal SELECT+DELETE table grants, in an isolated Neon validation branch before production. A disposable PostgreSQL 17 CI job now verifies real RLS and these restricted grants, but Neon itself remains unchanged.
2. Attach credentials through a protected secret store, not source code, issue comments or logs. Establish separate access from Resend and family-facing queries.
3. Define monitored operational failures, an external alert channel, alert recipient, and retry/lock strategy. Successful count reporting must not replace failure alerting.
4. Implement the trusted scheduler runner that obtains DB credentials, initializes a pool, invokes the bounded worker, and closes it even when execution fails.
5. Prove that concurrent workers cannot overlap destructively, that errors are raised, and that deletion complies with the approved privacy retention policy. `SKIP LOCKED` helps row-level contention but does not prove whole-job mutual exclusion.
6. Run end-to-end disposal tests in a disposable environment, then stage and review a separate activation change.
7. The production webhook remains fail-closed. Do not connect it to this workflow.

## Review checklist

- [x] Worker and unit tests staged in PR.
- [x] Scheduled placeholder checks the disabled gate only.
- [x] Fail-closed default has no DB initialization.
- [x] Disposable PostgreSQL role/RLS and expired-only deletion tested in GitHub Actions #51.
- [ ] Separate least-privilege Neon role.
- [ ] Authenticated, approved execution identity and runtime adapter.
- [ ] Operational alerting and on-call runbook.
- [ ] Full tenant isolation, consent, and retention policy review.
- [ ] Explicit production deployment decision.

**No live WhatsApp message purge has been scheduled or activated.**

## TTP 219 concurrency primitive (staged, not wired)

- `lib/whatsapp/retention-lock.js` now implements a transaction-scoped advisory lock on one dedicated PostgreSQL connection, with explicit `busy`, `ROLLBACK` and `COMMIT` behavior.
- Mock-backed tests cover lock acquisition, contention, rollback on errors, and connection release; this primitive is **not yet connected** to `runRetentionJob` or tested for concurrent real PostgreSQL sessions.
- A future integration must run the entire bounded purge within the same transaction/client, verify the restricted maintenance role on that connection, commit before reporting success, and alert reliably on errors. Never run `pool.query()` on an arbitrary connection while relying on transaction-level locking.
- Neon branch audit on 2026-11-08 verified the isolated WhatsApp validation branch exists, but the dedicated `nexlupa_whatsapp_retention` role is absent. No role changes or production changes were made.
