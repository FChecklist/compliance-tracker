import json
d = json.load(open('/opt/veridian/ai-os/memory/ZAI_BLACKBOX_AUDIT_POINTS_MANIFEST.json'))
print(type(d))
if isinstance(d, dict):
    print(list(d.keys()))
    for k in d:
        if isinstance(d[k], list):
            print(k, len(d[k]))
else:
    print(len(d))
