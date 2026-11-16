"""Writes test/stats/reference-numpy-mt19937.json: numpy's 32-bit Mersenne Twister, seeded with
init_genrand (numpy's legacy integer seeding), as raw 32-bit outputs and as genrand_res53 doubles.
The raw sequences cross two state regenerations (624 outputs each). Test-only oracle. Run in a
container:
  docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w python:3.13-slim \
    sh -c "pip install -q --require-hashes -r scripts/stats/oracle-requirements.txt && python scripts/stats/reference-mt19937.py"
"""
import json

import numpy as np

SEEDS = [1, 42, 5489, 2026, 4294967295]
RAW = 1300
UNIFORM = 700


def raw(seed):
    generator = np.random.MT19937(0)
    generator._legacy_seeding(seed)
    return [int(v) for v in generator.random_raw(RAW)]


def uniform(seed):
    return [float(v) for v in np.random.RandomState(seed).random_sample(UNIFORM)]


cases = [{"seed": s, "raw": raw(s), "uniform": uniform(s)} for s in SEEDS]
with open("test/stats/reference-numpy-mt19937.json", "w") as out:
    json.dump({"oracle": f"numpy {np.__version__}", "cases": cases}, out, indent=None)
    out.write("\n")
