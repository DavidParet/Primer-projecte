#!/usr/bin/env bash
# Disposable PostgreSQL only. Execute after whatsapp-family-membership-contract.sql.
set -euo pipefail
holder_log="$(mktemp)"
conflict_log="$(mktemp)"
trap 'rm -f "$holder_log" "$conflict_log"' EXIT

# Restore a known active synthetic membership.
psql -v ON_ERROR_STOP=1 -qAtc \
  "UPDATE nex_ci_family_memberships SET status='active',revoked_at=NULL
   WHERE user_id='account-b'
     AND family_id='22222222-2222-4222-8222-222222222222';"

# Session 1: lock the membership row, as the transaction-scoped authorizer does.
PGAPPNAME=nex_ci_auth_holder psql -v ON_ERROR_STOP=1 -qAtc \
  "BEGIN;
   SELECT role FROM nex_ci_family_memberships
   WHERE user_id='account-b'
   AND family_id='22222222-2222-4222-8222-222222222222'
   FOR SHARE;
   SELECT pg_sleep(4);
   COMMIT;" >"$holder_log" 2>&1 &
holder=$!

# Wait for the row lock to be established rather than racing a fixed delay.
seen=false
for i in $(seq 1 40); do
  waiting="$(psql -v ON_ERROR_STOP=1 -qAtc \
    "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE
      application_name='nex_ci_auth_holder' AND state='active'
      AND wait_event='PgSleep')")"
  if [[ "$waiting" == 't' ]]; then seen=true; break; fi
  if ! kill -0 "$holder" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$seen" != "true" ]]; then
  wait "$holder" || true
  echo 'Membership lock holder was not observed' >&2
  exit 1
fi

# Session 2: revocation must not overtake session 1's verified membership.
# Short lock_timeout deliberately forces a safe PostgreSQL error rather than waiting.
if psql -v ON_ERROR_STOP=1 -qAtc \
  "SET lock_timeout='300ms';
   UPDATE nex_ci_family_memberships SET status='suspended',updated_at=now()
   WHERE user_id='account-b'
   AND family_id='22222222-2222-4222-8222-222222222222';" >"$conflict_log" 2>&1; then
  echo 'Revocation bypassed active membership row lock' >&2
  wait "$holder" || true
  exit 1
fi
if ! grep -q 'lock timeout' "$conflict_log"; then
  echo 'Expected a lock timeout, not an unrelated SQL failure' >&2
  wait "$holder" || true
  exit 1
fi

wait "$holder"

# Once the first transaction finishes, revocation must succeed.
psql -v ON_ERROR_STOP=1 -qAtc \
  "UPDATE nex_ci_family_memberships SET status='suspended',updated_at=now()
   WHERE user_id='account-b'
   AND family_id='22222222-2222-4222-8222-222222222222';"
state="$(psql -v ON_ERROR_STOP=1 -qAtc \
 "SELECT status FROM nex_ci_family_memberships
  WHERE user_id='account-b'
  AND family_id='22222222-2222-4222-8222-222222222222'")"
if [[ "$state" != 'suspended' ]]; then
  echo 'Membership not suspended after lock release' >&2
  exit 1
fi
echo 'Two-session transactional family revocation ordering passed'
