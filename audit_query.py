import sqlite3
conn = sqlite3.connect("file:/opt/veridian/ai-os/memory/superboss-register.sqlite?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
cur = conn.cursor()
cur.execute("SELECT * FROM pm_decisions_pending WHERE id IN (212, 291, 105)")
rows = cur.fetchall()
for r in rows:
    print("----- id", r["id"], "-----")
    for k in r.keys():
        print(k, ":", r[k])
    print()
