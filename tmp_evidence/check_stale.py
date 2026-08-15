import json
import datetime

d = json.load(open("/opt/veridian/ai-os/tasks/task-20260815-041536-urgent-platform-blocker--dispatch-queue/workspace/tmp_evidence/queued_full.json"))
rows = d["matches"]
print("total queued:", len(rows))
now = datetime.datetime(2026, 8, 15, 4, 20, tzinfo=datetime.timezone.utc)
stale = []
for r in rows:
    ts = r["ts_submitted"]
    tsdt = datetime.datetime.fromisoformat(ts)
    age_h = (now - tsdt).total_seconds() / 3600
    reason = (r.get("reason") or "").lower()
    if age_h > 4 or "resubmit" in reason:
        stale.append((r["umr_id"], r["task_identity"], ts, round(age_h, 1), r.get("reason")))
print("stale/resubmitted candidates:", len(stale))
for s in stale:
    print(s)
