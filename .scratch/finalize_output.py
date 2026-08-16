import json

d = json.load(open('ai-os/registry/pr-classification-20260816.json'))
decisions = json.load(open('.scratch/disposal_decisions.json'))
safe = decisions['safe_to_close']
reviewed = decisions['reviewed_not_closed_real_content']
not_verified = set(decisions['not_individually_verified_left_open'])

by_num = {str(p['number']): p for p in d['prs']}

closed_count = 0
for num, citation in safe.items():
    p = by_num[num]
    p['disposition'] = 'CLOSED_SUPERSEDED'
    p['disposition_reason'] = citation
    closed_count += 1

for num, why in reviewed.items():
    p = by_num[num]
    p['disposition'] = 'LEFT_OPEN_REAL_CONTENT'
    p['disposition_reason'] = why

for num in not_verified:
    p = by_num[num]
    p['disposition'] = 'LEFT_OPEN_NOT_VERIFIED'
    p['disposition_reason'] = (
        'DOCS-ONLY, UMR id present, but not individually content-verified against '
        'main within this task\'s review budget -- left open per the conservative '
        'disposal mandate (never close without a verified citation).'
    )

for p in d['prs']:
    if 'disposition' not in p:
        if p['class'] == 'EMPTY':
            p['disposition'] = 'CLOSED_EMPTY'
        else:
            p['disposition'] = 'NOT_REVIEWED_FOR_DISPOSAL'

d['disposalSummary'] = {
    'step': 'STEP TWO -- conservative disposal, 2026-08-16',
    'emptyClassClosed': 0,
    'docsOnlyClosedSuperseded': closed_count,
    'docsOnlyReviewedLeftOpenRealContent': len(reviewed),
    'docsOnlyLeftOpenNotIndividuallyVerified': len(not_verified),
    'note': (
        'EMPTY class had 0 members this run -- nothing to close there. Of 115 '
        'DOCS-ONLY PRs, 26 named a UMR id in their title and were individually '
        'content-diffed against main; 13 were confirmed duplicate/superseded '
        '(closed, cited per-PR) and 8 were found to contain real, unique, '
        'unshipped content (proposals, bug findings, live corrections) that main '
        'does not yet capture -- left open per the "never destroy real unshipped '
        'work" mandate. 4 UMR-bearing candidates and all 89 remaining DOCS-ONLY '
        'PRs (47 with no UMR id in title, checked for uniquely-named-file '
        'presence on main with zero matches, plus the 42 UMR-bearing PRs whose '
        'UMR never appears anywhere on main) were left open as not superseded / '
        'not individually verified. CODE (299) and DEPENDENCY (8) classes were '
        'never considered for closure.'
    ),
}

with open('ai-os/registry/pr-classification-20260816.json', 'w') as fh:
    json.dump(d, fh, indent=2)
    fh.write('\n')

print('closed:', closed_count, 'reviewed-left-open:', len(reviewed), 'not-verified-left-open:', len(not_verified))
