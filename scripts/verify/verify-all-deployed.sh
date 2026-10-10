#!/usr/bin/env bash
# register: BR-314
#
# WO 3.4 (PROJEXA-BUILD-001, unit U-23): verify:all against a DEPLOYED instance. Blocked on the owner's go-live (Vercel is locked, PMD-11,
# C9), so this is a skeleton: it verifies nothing. It requires DEPLOY_URL (https only), exits 3 when it is missing or not https, and
# otherwise says plainly that the deployed half does not exist yet and exits 3. It never prints VERIFY-ALL-DEPLOYED-GATE: PASS.
#
# What the finished version must do (register row BR-314): run the requirement checks that can run against a live URL, and every result
# line must carry the deployment URL, for example `CHECK <id> <class> <seconds>s url=<DEPLOY_URL>`, with the last line
# `VERIFY-ALL-DEPLOYED-GATE: PASS` only when every check passed. Until a deployment exists there is nothing to check.
#
# Exit 3 = cannot run (always, today). Usage: DEPLOY_URL=https://<host> bash scripts/verify/verify-all-deployed.sh
set -u

if [ -z "${DEPLOY_URL:-}" ]; then
  echo "cannot run: DEPLOY_URL is not set (give the https URL of the deployed instance)" >&2
  echo "VERIFY-ALL-DEPLOYED-GATE: FAIL cannot run: DEPLOY_URL is not set"
  exit 3
fi
case "$DEPLOY_URL" in
  https://?*) ;;
  *)
    echo "cannot run: DEPLOY_URL must start with https://" >&2
    echo "VERIFY-ALL-DEPLOYED-GATE: FAIL cannot run: DEPLOY_URL is not an https URL"
    exit 3
    ;;
esac

echo "cannot run: the deployed half of verify:all is not implemented. It waits for a deployment (Vercel is locked, PMD-11); nothing was checked against the URL you gave" >&2
echo "VERIFY-ALL-DEPLOYED-GATE: FAIL not implemented until a deployment exists"
exit 3
