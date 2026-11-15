"""Writes fixtures/digests.json: canonical forms and digests computed by an implementation that
shares no code with Ichnaea (the Python `rfc8785` package), including the normative projections
of the configuration identity and the case-set digest. Test-only oracle: Ichnaea's runtime has no
Python dependency. Run: python digest_vectors.py <fixtures dir>
"""
import hashlib
import json
import pathlib
import sys

import rfc8785

root = pathlib.Path(sys.argv[1])


def digest(value):
    return "sha256:" + hashlib.sha256(rfc8785.dumps(value)).hexdigest()


def utf16_key(text):
    return text.encode("utf-16-be")


def configuration_identity(config):
    projection = {k: v for k, v in config.items() if k != "label"}
    projection["models"] = sorted(config["models"], key=lambda m: utf16_key(m["role"]))
    projection["parameters"] = sorted(config["parameters"], key=lambda p: utf16_key(p["name"]))
    projection["prompts"] = sorted(config["prompts"], key=lambda p: utf16_key(p["name"]))
    return digest(projection)


def case_set_digest(entries):
    keep = ("id", "digest", "pool", "family")
    projected = [{k: e[k] for k in keep if k in e} for e in entries]
    return digest(sorted(projected, key=lambda e: utf16_key(e["id"])))


values = [
    {"name": "numbers", "input": [0, -0.0, 1, -1, 0.1, 1e21, 1e-7, 5e-324, 1.7976931348623157e308, 9007199254740992.0, 333333333.3333333, 1.2345678901234568e20, 0.000001, 1e-6, 4.5, 2e-3]},
    {"name": "unicode-members", "input": {"€": 1, "\r": 2, "דּ": 3, "1": 4, "\U0001f600": 5, "\u0080": 6, "ö": 7, "á": 8, "": 9}},
    {"name": "escapes", "input": {"s": "\u0000\u001f\"\\/\b\f\n\r\t\u007f  \U0001f600 é"}},
    {"name": "nesting", "input": {"z": [{"b": None, "a": True}, [], {}], "a": {"y": False, "x": "text"}}},
]
vectors = [{"kind": "canonical", "name": v["name"], "input": v["input"], "canonical": rfc8785.dumps(v["input"]).decode("utf-8"), "digest": digest(v["input"])} for v in values]

config = json.loads((root / "valid" / "configuration.json").read_text(encoding="utf-8"))
vectors.append({"kind": "configurationIdentity", "name": "valid-configuration", "input": config, "digest": configuration_identity(config)})
reordered = dict(config, models=list(reversed(config["models"])), parameters=list(reversed(config["parameters"])), label="renamed")
vectors.append({"kind": "configurationIdentity", "name": "reordered-and-relabelled", "input": reordered, "digest": configuration_identity(reordered)})
two_models = dict(config, models=config["models"] + [{"role": "Rerank", "provider": {"value": "p", "status": "pinned"}, "id": {"value": "r-1", "status": "declared"}}, {"role": "éval", "provider": {"value": "p", "status": "pinned"}, "id": {"value": "e-1", "status": "pinned"}}])
vectors.append({"kind": "configurationIdentity", "name": "three-models-unicode-roles", "input": two_models, "digest": configuration_identity(two_models)})

case = json.loads((root / "valid" / "case.json").read_text(encoding="utf-8"))
vectors.append({"kind": "caseDigest", "name": "valid-case", "input": case, "digest": digest(case)})

case_set = json.loads((root / "valid" / "caseSet.json").read_text(encoding="utf-8"))
vectors.append({"kind": "caseSetDigest", "name": "valid-case-set", "input": case_set["cases"], "digest": case_set_digest(case_set["cases"])})
unicode_entries = [{"id": "b-2", "digest": "sha256:" + "1" * 64, "pool": "sealed"}, {"id": "Z-1", "digest": "sha256:" + "2" * 64, "pool": "development", "family": "f"}, {"id": "a-3", "digest": "sha256:" + "3" * 64, "pool": "validation"}, {"id": "9.x", "digest": "sha256:" + "4" * 64, "pool": "promoted"}]
vectors.append({"kind": "caseSetDigest", "name": "mixed-case-ids", "input": unicode_entries, "digest": case_set_digest(unicode_entries)})

out = {"oracle": f"python rfc8785 {rfc8785.__version__ if hasattr(rfc8785, '__version__') else '0.1.4'}", "vectors": vectors}
(root / "digests.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {len(vectors)} vectors")
