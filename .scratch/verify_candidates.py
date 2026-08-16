import json, re, os

cands = json.load(open('.scratch/docsonly_umr_matches.json'))
cands = [c for c in cands if c['umrs'] and any(c['main_matches'].get(u) for u in c['umrs'])]

VERDICT_WORDS = ['killed', 'correct', 'duplicate', 'self-correct', 'no correction needed',
                  'no fix needed', 'confirmed', 'stale', 'closed', 'terminal']

def verdict_set(text):
    t = text.lower()
    return set(w for w in VERDICT_WORDS if w in t)

out = []
for c in cands:
    title_v = verdict_set(c['title'])
    main_files = set()
    for u in c['umrs']:
        for f in c['main_matches'].get(u, []):
            main_files.add(f)
    main_text = ""
    for f in main_files:
        p = os.path.join('.scratch/main-tree', f)
        if os.path.isfile(p):
            try:
                main_text += open(p, errors='ignore').read() + "\n"
            except Exception:
                pass
    main_v = verdict_set(main_text)
    overlap = title_v & main_v
    out.append({
        "number": c['number'], "title": c['title'], "umrs": c['umrs'],
        "main_files": sorted(main_files),
        "title_verdicts": sorted(title_v), "main_verdicts": sorted(main_v),
        "overlap": sorted(overlap), "consistent": bool(overlap),
    })

json.dump(out, open('.scratch/verify_results.json', 'w'), indent=2)
inconsistent = [o for o in out if not o['consistent']]
print("total candidates:", len(out))
print("inconsistent (no verdict-word overlap, needs manual check):", len(inconsistent))
for o in inconsistent:
    print(" ", o['number'], o['title'][:80], '| main_files=', o['main_files'])
