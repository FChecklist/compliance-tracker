#!/usr/bin/env bash
# Body of .github/workflows/domain-drift-check.yml's check step, extracted so it
# can be run against a local mock of the Vercel API (scripts/check-domain-drift.
# test.ts) instead of only ever being exercised by the live 15-minute cron.
#
# WHY THIS EXISTS AS A SCRIPT, NOT INLINE (found 2026-09-25): every scheduled run
# since at least 2026-09-20 concluded failure with "domain is NOT attached
# there. Drift detected." for projexa-ai.com and www.projexa-ai.com, while a
# read-only Vercel API check the same day showed BOTH hostnames attached to the
# canonical project, verified -- so there was no real drift. The previous
# inline step used `curl -sf`, and `-f` collapses every HTTP >= 400 into one
# non-zero exit, so a 401/403 (expired, revoked, or under-scoped
# VERCEL_ACCESS_TOKEN) was reported as "domain is NOT attached" -- a bad
# credential masquerading as an ownership change. Diagnosing that took reading
# the workflow's own curl flags because the log said nothing true about why.
#
# THE FIX: capture the HTTP status separately (`-o <file> -w '%{http_code}'`)
# and give every outcome its own honest message and exit code:
#
#   200, projectId == canonical         -> OK
#   200, projectId != canonical         -> DRIFT (exit 1)
#   404                                 -> DRIFT: domain not attached (exit 1)
#   401 / 403                           -> GUARD COULD NOT RUN: the
#                                          VERCEL_ACCESS_TOKEN secret is bad
#                                          (exit 2) -- not evidence of drift
#   anything else (5xx, 429, no reply)  -> GUARD COULD NOT RUN: API error (exit 2)
#   200 but no projectId in the body    -> GUARD COULD NOT RUN (exit 2)
#   empty/unset token                   -> GUARD COULD NOT RUN (exit 2), no API call
#
# A guard that cannot run must not look green, so every "could not run" case
# still exits non-zero -- it just says what is actually wrong. If a drift is
# proven for any domain the script exits 1 even when another domain could not
# be verified (a real ownership change outranks a credential problem).
#
# GET-only. Never calls a mutating Vercel endpoint and never uses
# `vercel domains rm` (removes team ownership, see ai-os/DOMAIN_OWNERSHIP.yaml
# rule 4). Never prints VERCEL_ACCESS_TOKEN: it is only sent in the
# Authorization header, and any API response text echoed into the log is
# collapsed to one line, length-capped, and scrubbed of the token's own value.
#
# VERCEL_API_BASE exists only so the test can point this at a local mock; the
# workflow never sets it, so the token only ever goes to api.vercel.com there.
set -euo pipefail

API_BASE="${VERCEL_API_BASE:-https://api.vercel.com}"
TEAM="team_Iqx3zyb7sDdsdzcNskCFFsHD"

# Canonical values from ai-os/DOMAIN_OWNERSHIP.yaml (kept in sync by hand --
# see that file's rule 3 for when/how this changes; check-domain-drift.test.ts
# fails if these stop matching it).
DOMAINS="projexa-ai.com www.projexa-ai.com"
CANONICAL_PROJECT_ID="prj_JA9mwUdOfW3SKSxjG4jdPo0R2iVM"
CANONICAL_PROJECT_NAME="projexa"

TOKEN_OWNER_ACTION="VERCEL_ACCESS_TOKEN GitHub Actions secret (repo Settings > Secrets and variables > Actions) -- replacing it is an OWNER action"

if [ -z "${VERCEL_ACCESS_TOKEN:-}" ]; then
  echo "::error::DRIFT GUARD COULD NOT RUN: the VERCEL_ACCESS_TOKEN secret is empty or not set, so no Vercel API call was made. This is NOT evidence of drift and NOT a pass. Owner action: set the ${TOKEN_OWNER_ACTION}."
  exit 2
fi

body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

# One line of what the API said, safe to put in a log annotation: newlines
# collapsed, capped at 200 chars, token value scrubbed if it was ever echoed.
api_detail() {
  local d
  d="$( { grep -o '"code"[[:space:]]*:[[:space:]]*"[^"]*"' "$body_file" | head -n 1
          grep -o '"message"[[:space:]]*:[[:space:]]*"[^"]*"' "$body_file" | head -n 1; } 2>/dev/null \
        | tr '\r\n' '  ' | cut -c1-200 || true)"
  d="${d//"$VERCEL_ACCESS_TOKEN"/[redacted]}"
  if [ -n "$d" ]; then echo "$d"; else echo "(no error body)"; fi
}

DRIFT=0
CANNOT_VERIFY=0

for domain in $DOMAINS; do
  echo "--- checking $domain ---"
  : > "$body_file"
  # curl still prints 000 for -w on a transport failure (refused, DNS, timeout)
  # but exits non-zero; swallow that so the status drives the branch below.
  code="$(curl -s -o "$body_file" -w '%{http_code}' --connect-timeout 10 --max-time 30 \
    -H "Authorization: Bearer ${VERCEL_ACCESS_TOKEN}" \
    "${API_BASE}/v9/projects/${CANONICAL_PROJECT_ID}/domains/${domain}?teamId=${TEAM}")" || true
  [ -n "$code" ] || code="000"

  case "$code" in
    200)
      actual_project="$(grep -o '"projectId"[[:space:]]*:[[:space:]]*"[^"]*"' "$body_file" | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
      if [ -z "$actual_project" ]; then
        echo "::error::$domain: HTTP 200 from the Vercel API but the response has no projectId, so ownership cannot be verified. The drift guard could not verify this domain -- this is NOT a pass and not proven drift."
        CANNOT_VERIFY=1
      elif [ "$actual_project" != "$CANONICAL_PROJECT_ID" ]; then
        echo "::error::$domain resolves to projectId=$actual_project, expected $CANONICAL_PROJECT_ID ($CANONICAL_PROJECT_NAME). Drift detected -- see ai-os/DOMAIN_OWNERSHIP.yaml before taking any action."
        DRIFT=1
      else
        echo "OK: $domain -> $CANONICAL_PROJECT_NAME ($actual_project)"
      fi
      ;;
    404)
      echo "::error::$domain: HTTP 404 from GET against the canonical project ($CANONICAL_PROJECT_NAME, $CANONICAL_PROJECT_ID) -- the domain is NOT attached there. Drift detected (unless the project/team id baked into this script is itself stale). API said: $(api_detail)"
      DRIFT=1
      ;;
    401|403)
      echo "::error::$domain: HTTP $code from the Vercel API -- the VERCEL_ACCESS_TOKEN secret is invalid, expired, revoked, or lacks access to team $TEAM. The drift guard could NOT check this domain; this is NOT evidence of drift. Owner action: replace the ${TOKEN_OWNER_ACTION}. API said: $(api_detail)"
      CANNOT_VERIFY=1
      ;;
    000)
      echo "::error::$domain: no HTTP response from the Vercel API (network failure, DNS, or timeout). The drift guard could NOT check this domain; this is NOT evidence of drift."
      CANNOT_VERIFY=1
      ;;
    *)
      echo "::error::$domain: unexpected HTTP $code from the Vercel API (API error, rate limit, or outage). The drift guard could NOT check this domain; this is NOT evidence of drift. API said: $(api_detail)"
      CANNOT_VERIFY=1
      ;;
  esac
done

if [ "$DRIFT" -ne 0 ]; then
  echo "::error::One or more domains have drifted from ai-os/DOMAIN_OWNERSHIP.yaml's canonical record. Read that file's rules before reassigning anything -- do not use 'vercel domains rm'."
  if [ "$CANNOT_VERIFY" -ne 0 ]; then
    echo "::error::Additionally, at least one other domain could not be verified (see above)."
  fi
  exit 1
fi

if [ "$CANNOT_VERIFY" -ne 0 ]; then
  echo "::error::DRIFT GUARD COULD NOT RUN to completion: no drift was proven, but at least one domain could not be verified (see above). Failing the run so an unverified guard never looks green."
  exit 2
fi

echo "All domains match ai-os/DOMAIN_OWNERSHIP.yaml."
