"""Recomputes every committed vector with an implementation that shares no code with Ichnaea
(the Python `rfc8785` package) and fails on any difference. CI runs this; generating new inputs is a
local step (digest_vectors.py), because random generation differs between Python versions.
Run: python verify_vectors.py <fixtures dir>
"""
import hashlib
import json
import pathlib
import sys

import rfc8785

root = pathlib.Path(sys.argv[1])


def digest(value):
    return "sha256:" + hashlib.sha256(rfc8785.dumps(value)).hexdigest()


failures = 0
generated = json.loads((root / "digests-generated.json").read_text(encoding="utf-8"))["vectors"]
for i, v in enumerate(generated):
    if rfc8785.dumps(v["input"]).decode("utf-8") != v["canonical"] or digest(v["input"]) != v["digest"]:
        failures += 1
        print(f"generated vector {i} differs")
for v in json.loads((root / "digests.json").read_text(encoding="utf-8"))["vectors"]:
    if v["kind"] == "canonical" and (rfc8785.dumps(v["input"]).decode("utf-8") != v["canonical"] or digest(v["input"]) != v["digest"]):
        failures += 1
        print(f"vector {v['name']} differs")
print(f"verified {len(generated)} generated vectors and the canonical vectors: {failures} differences")
sys.exit(1 if failures else 0)
