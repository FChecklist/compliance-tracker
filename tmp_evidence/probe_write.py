import sys
path = sys.argv[1]
with open(path, "w") as f:
    f.write("probe\n")
print("write succeeded:", path)
