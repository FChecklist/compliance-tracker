import sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()
old = "SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))"
new = "SCRIPTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))"
assert old in content
content = content.replace(old, new, 1)
with open(path, "w") as f:
    f.write(content)
print("fixed SCRIPTS_DIR in", path)
