#!/usr/bin/env bash
# Disposable GitHub Actions Postgres only. Never points to Neon.
set -euo pipefail
lock_session_file="$(mktemp)"
trap 'rm -f "$lock_session_file"' EXIT

# Session 1 holds the same transaction-scoped advisory lock as retention-lock.js.
psql -v ON_ERROR_STOP=1 -Atqc "BEGIN; SELECT pg_advisory_xact_lock(716200, 1); SELECT pg_sleep(5); COMMIT;" > "$lock_session_file" &
holder_pid=$!

# Wait until the lock is actually acquired, avoiding a flaky fixed delay.
acquired="false"
for i in $(seq 1 30); do
  if psql -Atqc "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=716200 AND objid=1 AND granted)" | grep -qx 't'; then
    acquired="true"
    break
  fi
  sleep 0.1
done

if [[ "$acquired" != "true" ]]; then
  wait "$holder_pid" || true
  echo 'Could not observe advisory lock holder' >&2
  exit 1
fi

# Session 2 must be refused while session 1 is still active.
busy_result="$(psql -Atqc "BEGIN; SELECT pg_try_advisory_xact_lock(716200, 1); ROLLBACK;" | head -n 1)"
if [[ "$busy_result" != "f" ]]; then
  echo 'Second session unexpectedly acquired retention lock' >&2
  exit 1
fi

wait "$holder_pid"

# After commit the same advisory lock must be available for another session.
available_result="$(psql -Atqc "BEGIN; SELECT pg_try_advisory_xact_lock(716200, 1); ROLLBACK;" | head -n 1)"
if [[ "$available_result" != "t" ]]; then
  echo 'Retention lock not released after transaction commit' >&2
  exit 1
fi

echo 'Two-session retention advisory lock test passed'
