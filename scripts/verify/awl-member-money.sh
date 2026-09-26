#!/usr/bin/env bash
# register: BR-495 (the helper its verify_command ends with; the two curl 400 checks in that command are run by the row itself)
# PROJEXA-BUILD-001 phase 4 (U-46b2): a member-role link must see no BOQ money. Reads one page of BOQ lines (limit 200, JSON asked for
# explicitly because the default answer is Markdown) with the MEMBER link and counts every money value that is not null. A money column
# that is absent from a row counts as hidden (the function omits some), not as a value.
# Money columns = what the member link's own /context lists under money_fields.boq_lines, plus the boq_lines money columns of the
# generated list in supabase/functions/ai-work-link/record-kinds.generated.json when that file is present. Taking the union means a
# context that forgets a column cannot hide a leak of it.
# It also refuses a link whose context does not say money_visible is false (a manager link on a project with no money would pass by accident).
# It refuses to pass on an empty page or an empty column list: a page with no rows proves nothing (exit 1, non_null is still printed).
#
# Environment: AWL_LINK_M  the pasted link of a member-role user (path mode).
#              AWL_CURL_TIMEOUT  seconds per request, default 30.
# Last stdout line: AWL_MEMBER_MONEY non_null=<n>   Exit 0 only when n is 0 and the page held at least one row and one column was checked.
# Exit 1 on any other outcome, 2 when AWL_LINK_M is missing.
# Self-test: bash scripts/verify/awl-scripts.selftest.sh
set -u
. "$(dirname "${BASH_SOURCE[0]}")/lib/awl-common.sh"

awl_need AWL_LINK_M
awl_need_tool curl
awl_need_tool node
LINK="$(awl_strip_slash "$AWL_LINK_M")"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KINDS_FILE="$ROOT/supabase/functions/ai-work-link/record-kinds.generated.json"
[ -f "$KINDS_FILE" ] || KINDS_FILE=""

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cctx="$(awl_norm_code "$(curl -s -o "$TMP/ctx.json" --max-time "$AWL_CURL_TIMEOUT" -H 'Accept: application/json' -w '%{http_code}' "$LINK/context" 2>/dev/null || true)")"
cpage="$(awl_norm_code "$(curl -s -o "$TMP/page.json" --max-time "$AWL_CURL_TIMEOUT" -H 'Accept: application/json' -w '%{http_code}' "$LINK/records/boq_lines?limit=200" 2>/dev/null || true)")"
if [ "$cctx" != "200" ] || [ "$cpage" != "200" ]; then
  awl_say "context answered $cctx and the BOQ page answered $cpage (both must be 200)"
  printf 'AWL_MEMBER_MONEY non_null=unknown\n'
  exit 1
fi

# prints "<non_null> <rows> <columns>" or "error <why>"
result="$(node -e '
const fs = require("fs");
const [ctxFile, pageFile, kindsFile] = process.argv.slice(1);
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const ctx = read(ctxFile), page = read(pageFile);
if (!ctx || !page || !Array.isArray(page.items)) { console.log("error the answers are not the expected JSON"); process.exit(0); }
if (!ctx.acting_for || ctx.acting_for.money_visible !== false) { console.log("error the link is not a member-role link (context does not say money_visible is false)"); process.exit(0); }
const cols = new Set((ctx.money_fields && ctx.money_fields.boq_lines) || []);
if (kindsFile) {
  const kinds = read(kindsFile);
  const k = Array.isArray(kinds) ? kinds.find((x) => x.kind === "boq_lines") : null;
  if (k && Array.isArray(k.money_columns)) k.money_columns.forEach((c) => cols.add(c));
}
let bad = 0;
for (const item of page.items) for (const c of cols) if (item[c] !== null && item[c] !== undefined) bad++;
console.log(bad + " " + page.items.length + " " + cols.size);
' "$TMP/ctx.json" "$TMP/page.json" "$KINDS_FILE" 2>/dev/null)"

case "$result" in
  error*) awl_say "${result#error }"; printf 'AWL_MEMBER_MONEY non_null=unknown\n'; exit 1 ;;
esac
nn="${result%% *}"; rest="${result#* }"; rows="${rest%% *}"; cols="${rest#* }"
if [ "$rows" = "0" ]; then awl_say "the page holds no BOQ line, so nothing was tested (use a project that has BOQ lines)"; printf 'AWL_MEMBER_MONEY non_null=%s\n' "$nn"; exit 1; fi
if [ "$cols" = "0" ]; then awl_say "no money column is known for boq_lines, so nothing was tested"; printf 'AWL_MEMBER_MONEY non_null=%s\n' "$nn"; exit 1; fi
awl_say "checked $rows BOQ line(s) against $cols money column(s)"
printf 'AWL_MEMBER_MONEY non_null=%s\n' "$nn"
if [ "$nn" = "0" ]; then exit 0; fi
exit 1
