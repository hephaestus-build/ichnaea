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


CASE_MEMBERS = ("id", "unit", "input", "turns", "fixtures", "references")
CONFIGURATION_MEMBERS = ("models", "parameters", "prompts", "factors")
ENTRY_MEMBERS = ("id", "digest", "pool", "family")


# Every top-level member a writer may emit (the strict writer schemas). An unknown member is an
# error before hashing: a misspelt or misplaced member must not leave a digest unchanged.
CASE_KNOWN = CASE_MEMBERS + ("schema", "caseSet", "dataClass", "family", "slices", "criticality", "provenance", "pool", "validation")
CONFIGURATION_KNOWN = CONFIGURATION_MEMBERS + ("schema", "description", "label", "informational")
ENTRY_KNOWN = ENTRY_MEMBERS


def pick(record, members, known):
    unknown = sorted(set(record) - set(known))
    if unknown:
        raise ValueError(f"unknown members {unknown}")
    return {k: record[k] for k in members if k in record}


def case_digest(case):
    return digest(pick(case, CASE_MEMBERS, CASE_KNOWN))


def configuration_identity(config):
    projection = pick(config, CONFIGURATION_MEMBERS, CONFIGURATION_KNOWN)
    projection["models"] = sorted(config["models"], key=lambda m: utf16_key(m["role"]))
    projection["parameters"] = sorted(config["parameters"], key=lambda p: utf16_key(p["name"]))
    projection["prompts"] = sorted(config["prompts"], key=lambda p: utf16_key(p["name"]))
    return digest(projection)


def case_set_digest(entries):
    projected = [pick(e, ENTRY_MEMBERS, ENTRY_KNOWN) for e in entries]
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

described = dict(config, description="described differently", informational={"provider.fingerprint": "fp_1"}, factors=dict(config["factors"], **{"__proto__": {"value": "kept", "status": "pinned", "part": "other"}}))
vectors.append({"kind": "configurationIdentity", "name": "description-informational-and-proto-factor", "input": described, "digest": configuration_identity(described)})
for name, bad in [("unknown-top-level-member", dict(config, tools=["search"]))]:
    try:
        configuration_identity(bad)
    except ValueError:
        vectors.append({"kind": "configurationIdentityRefused", "name": name, "input": bad, "digest": ""})

case = json.loads((root / "valid" / "case.json").read_text(encoding="utf-8"))
vectors.append({"kind": "caseDigest", "name": "valid-case", "input": case, "digest": case_digest(case)})
reviewed = dict(case, provenance=dict(case["provenance"], author="someone else"), validation={"status": "validated"}, pool="sealed")
vectors.append({"kind": "caseDigest", "name": "provenance-pool-and-review-excluded", "input": reviewed, "digest": case_digest(reviewed)})
proto = dict(case, input=dict(case["input"], **{"__proto__": "data, not a prototype"}))
vectors.append({"kind": "caseDigest", "name": "proto-member-in-input", "input": proto, "digest": case_digest(proto)})

case_set = json.loads((root / "valid" / "caseSet.json").read_text(encoding="utf-8"))
vectors.append({"kind": "caseSetDigest", "name": "valid-case-set", "input": case_set["cases"], "digest": case_set_digest(case_set["cases"])})
unicode_entries = [{"id": "b-2", "digest": "sha256:" + "1" * 64, "pool": "sealed"}, {"id": "Z-1", "digest": "sha256:" + "2" * 64, "pool": "development", "family": "f"}, {"id": "a-3", "digest": "sha256:" + "3" * 64, "pool": "validation"}, {"id": "9.x", "digest": "sha256:" + "4" * 64, "pool": "promoted"}]
vectors.append({"kind": "caseSetDigest", "name": "mixed-case-ids", "input": unicode_entries, "digest": case_set_digest(unicode_entries)})

out = {"oracle": f"python rfc8785 {rfc8785.__version__ if hasattr(rfc8785, '__version__') else '0.1.4'}", "vectors": vectors}
(root / "digests.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {len(vectors)} vectors")


# 1,000 generated vectors: doubles over the whole range, arbitrary Unicode member names and strings.
import math
import random
import struct

rng = random.Random(20261115)


def a_double():
    kind = rng.random()
    if kind < 0.4:
        while True:
            value = struct.unpack("<d", rng.getrandbits(64).to_bytes(8, "little"))[0]
            if math.isfinite(value):
                return value
    if kind < 0.7:
        return rng.uniform(-1, 1) * 10.0 ** rng.randint(-330, 308)
    if kind < 0.85:
        return float(rng.randint(-2**53, 2**53))
    return rng.choice([0.0, -0.0, 5e-324, 1.7976931348623157e308, 1e21, 1e-7, 2.0**53, 2.0**64, 0.1, 1 / 3])


def a_char():
    while True:
        cp = rng.choice([rng.randint(0x20, 0x7E), rng.randint(0, 0x1F), rng.randint(0x80, 0xFFFF), rng.randint(0x10000, 0x10FFFF)])
        if not 0xD800 <= cp <= 0xDFFF:
            return chr(cp)


def a_string():
    return "".join(a_char() for _ in range(rng.randint(0, 6)))


def a_value(depth=0):
    kind = rng.random()
    if depth > 2 or kind < 0.35:
        return a_double()
    if kind < 0.5:
        return a_string()
    if kind < 0.55:
        return rng.choice([True, False, None])
    if kind < 0.75:
        return [a_value(depth + 1) for _ in range(rng.randint(0, 4))]
    return {a_string(): a_value(depth + 1) for _ in range(rng.randint(0, 4))}


generated = []
for i in range(1000):
    value = {a_string(): a_value() for _ in range(rng.randint(1, 5))}
    generated.append({"canonical": rfc8785.dumps(value).decode("utf-8"), "digest": digest(value), "input": value})
(root / "digests-generated.json").write_text(json.dumps({"oracle": "python rfc8785 0.1.4", "seed": 20261115, "vectors": generated}, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"wrote {len(generated)} generated vectors")
