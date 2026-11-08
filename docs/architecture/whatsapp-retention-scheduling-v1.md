# NexLupa — Scheduled WhatsApp retention: staged, NOT active

## Current status

- The schedule definition on the WhatsApp prototype branch is a **disabled safety check**. Even if merged into the default branch, its daily cron at 03:17 UTC performs **no database connection and no deletion**.
- `lib/whatsapp/retention-scheduler.js` defaults to `enabled=false`; it refuses active execution without a separate maintenance DB factory, monitored reporting, and a closable DB adapter.
- `lib/whatsapp/retention-worker.js` has bounded deletion queries, structured count-only reporting, and propagates errors. Its unit tests and separate disposable PostgreSQL tests cover retention behavior.
- **No Neon credentials, project IDs, connection strings, real sender IDs, or webhook changes are included in the scheduled workflow.**
- GitHub Actions workflows only run scheduled events from the default branch; the workflow is currently on the PR branch.

## Activation requirements (not implemented)

1. Approve a separate dedicated non-owner PostgreSQL maintenance role and minimal table grants, in an isolated Neon validation branch before production.
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
- [ ] Separate least-privilege Neon role.
- [ ] Authenticated, approved execution identity and runtime adapter.
- [ ] Operational alerting and on-call runbook.
- [ ] Full tenant isolation, consent, and retention policy review.
- [ ] Explicit production deployment decision.

**No live WhatsApp message purge has been scheduled or activated.**
