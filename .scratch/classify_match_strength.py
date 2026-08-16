import json
v = json.load(open('.scratch/verify_results.json'))
strong = []
weak = []
for x in v:
    umrs = [u.lower().replace('umr-', '') for u in x['umrs']]
    # strong: at least one main file's own name embeds one of this PR's UMR ids
    is_strong = False
    for f in x['main_files']:
        fl = f.lower()
        for u in x['umrs']:
            if u.lower() in fl:
                is_strong = True
    if is_strong:
        strong.append(x)
    else:
        weak.append(x)

print("STRONG (own UMR id embedded in the matched main filename):", len(strong))
for s in strong:
    print(" ", s['number'], s['title'][:80], '->', s['main_files'])
print()
print("WEAK (UMR id only found via cross-reference/full-text mention):", len(weak))
for w in weak:
    print(" ", w['number'], w['title'][:80], '->', w['main_files'])
