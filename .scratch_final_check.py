import json, subprocess
out = subprocess.run(["gh", "pr", "view", "1199", "--json", "statusCheckRollup"], capture_output=True, text=True)
d = json.loads(out.stdout)
for c in d.get("statusCheckRollup", []):
    print(c.get("name"), "|", c.get("status"), "|", c.get("conclusion"))
