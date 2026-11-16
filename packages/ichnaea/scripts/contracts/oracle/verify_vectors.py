"""Recomputes every committed vector with an implementation that shares no code with Ichnaea
(the Python `rfc8785` package and the projections in projections.py) and fails on any
difference. CI runs this; generating new inputs is a
local step (digest_vectors.py), because random generation differs between Python versions.
Run: python verify_vectors.py <fixtures dir>
"""
import json
import pathlib
import sys

import rfc8785

from projections import Projections, digest

root = pathlib.Path(sys.argv[1])
P = Projections(root)

failures = 0
generated = json.loads((root / "digests-generated.json").read_text(encoding="utf-8"))["vectors"]
for i, v in enumerate(generated):
    if rfc8785.dumps(v["input"]).decode("utf-8") != v["canonical"] or digest(v["input"]) != v["digest"]:
        failures += 1
        print(f"generated vector {i} differs")
named = json.loads((root / "digests.json").read_text(encoding="utf-8"))["vectors"]
for v in named:
    if v["kind"] == "canonical":
        differs = rfc8785.dumps(v["input"]).decode("utf-8") != v["canonical"] or digest(v["input"]) != v["digest"]
    else:
        differs = P.compute(v) != v["digest"]
    if differs:
        failures += 1
        print(f"vector {v['kind']} {v['name']} differs")
print(f"verified {len(generated)} generated vectors and {len(named)} canonical and projection vectors: {failures} differences")
sys.exit(1 if failures else 0)
