"""Writes test/stats/reference-python-krippendorff.json: Krippendorff's alpha from the Python
package `krippendorff`, a second oracle beside R's irr, for every reliability matrix of
test/stats/reference-agreement-inputs.json. Test-only, in the pinned Python image that CI uses:

    pip install --require-hashes -r scripts/stats/oracle-requirements.txt
    python scripts/stats/reference-krippendorff.py
"""

import json

import krippendorff
import numpy as np

with open("test/stats/reference-agreement-inputs.json", encoding="utf-8") as f:
    inputs = json.load(f)

results = []
for matrix in inputs["reliability"]:
    # The package wants one row per rater, with NaN for a missing value.
    units = np.array(
        [[np.nan if v is None else float(v) for v in unit] for unit in matrix["units"]]
    ).T
    results.append(
        {
            "id": matrix["id"],
            **{
                level: float(krippendorff.alpha(reliability_data=units, level_of_measurement=level))
                for level in ("nominal", "ordinal", "interval")
            },
        }
    )

with open("test/stats/reference-python-krippendorff.json", "w", encoding="utf-8") as f:
    json.dump({"reliability": results}, f, separators=(",", ":"))
    f.write("\n")
