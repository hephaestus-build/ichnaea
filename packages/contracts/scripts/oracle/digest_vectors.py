"""Writes fixtures/digests.json: canonical forms and digests computed by an implementation that
shares no code with Ichnaea (the Python `rfc8785` package), including the normative projections
of the configuration identity and the case-set digest. Test-only oracle: Ichnaea's runtime has no
Python dependency. Run: python digest_vectors.py <fixtures dir> [--generated]
"""
import json
import pathlib
import sys

import rfc8785

root = pathlib.Path(sys.argv[1])

from projections import Projections, digest, text_digest

P = Projections(root)


values = [
    {"name": "numbers", "input": [0, -0.0, 1, -1, 0.1, 1e21, 1e-7, 5e-324, 1.7976931348623157e308, 9007199254740992.0, 333333333.3333333, 1.2345678901234568e20, 0.000001, 1e-6, 4.5, 2e-3]},
    {"name": "unicode-members", "input": {"€": 1, "\r": 2, "דּ": 3, "1": 4, "\U0001f600": 5, "\u0080": 6, "ö": 7, "á": 8, "": 9}},
    {"name": "escapes", "input": {"s": "\u0000\u001f\"\\/\b\f\n\r\t\u007f  \U0001f600 é"}},
    {"name": "nesting", "input": {"z": [{"b": None, "a": True}, [], {}], "a": {"y": False, "x": "text"}}},
]
vectors = [{"kind": "canonical", "name": v["name"], "input": v["input"], "canonical": rfc8785.dumps(v["input"]).decode("utf-8"), "digest": digest(v["input"])} for v in values]

config = json.loads((root / "valid" / "configuration.json").read_text(encoding="utf-8"))
vectors.append({"kind": "configurationIdentity", "name": "valid-configuration", "input": config, "digest": P.configuration_identity(config)})
reordered = dict(config, models=list(reversed(config["models"])), parameters=list(reversed(config["parameters"])), label="renamed")
vectors.append({"kind": "configurationIdentity", "name": "reordered-and-relabelled", "input": reordered, "digest": P.configuration_identity(reordered)})
two_models = dict(config, models=config["models"] + [{"role": "Rerank", "provider": {"value": "p", "status": "pinned"}, "id": {"value": "r-1", "status": "declared"}}, {"role": "éval", "provider": {"value": "p", "status": "pinned"}, "id": {"value": "e-1", "status": "pinned"}}])
vectors.append({"kind": "configurationIdentity", "name": "three-models-unicode-roles", "input": two_models, "digest": P.configuration_identity(two_models)})

described = dict(config, description="described differently", informational={"provider.fingerprint": "fp_1"}, factors=dict(config["factors"], **{"__proto__": {"value": "kept", "status": "pinned", "part": "other"}}))
vectors.append({"kind": "configurationIdentity", "name": "description-informational-and-proto-factor", "input": described, "digest": P.configuration_identity(described)})
template = "Answer from the help centre only."
resolved = dict(config, prompts=[dict(p, template=template, uri="file:prompts/answer.txt", digest=text_digest(template)) for p in config["prompts"]])
declared = dict(config, prompts=[dict(p, digest=text_digest(template)) for p in config["prompts"]])
vectors.append({"kind": "configurationIdentity", "name": "prompt-template-and-uri-recorded", "input": resolved, "digest": P.configuration_identity(resolved)})
vectors.append({"kind": "configurationIdentity", "name": "prompt-digest-only", "input": declared, "digest": P.configuration_identity(declared)})
assert P.configuration_identity(resolved) == P.configuration_identity(declared)
plan = json.loads((root / "valid" / "plan.json").read_text(encoding="utf-8"))
candidate = plan["arms"][1]["configuration"]
assert "template" in candidate["prompts"][0] and plan["arms"][1]["identity"] == P.configuration_identity(candidate)
vectors.append({"kind": "configurationIdentity", "name": "plan-arm-with-template-ending-in-a-newline", "input": candidate, "digest": P.configuration_identity(candidate)})
stripped = dict(candidate, prompts=[dict(p, template=p["template"].strip()) for p in candidate["prompts"]])
vectors.append({"kind": "configurationIdentityRefused", "name": "template-digest-is-of-the-bytes-as-written", "input": stripped, "digest": ""})
assert P.compute(vectors[-1]) == ""
for name, bad in [("unknown-top-level-member", dict(config, tools=["search"])), ("unknown-prompt-member", dict(config, prompts=[dict(p, templat="x") for p in config["prompts"]])), ("template-contradicts-digest", dict(config, prompts=[dict(p, template="not the digested text") for p in config["prompts"]]))]:
    if P.compute({"kind": "configurationIdentityRefused", "input": bad}) == "":
        vectors.append({"kind": "configurationIdentityRefused", "name": name, "input": bad, "digest": ""})

case = json.loads((root / "valid" / "case.json").read_text(encoding="utf-8"))
vectors.append({"kind": "caseDigest", "name": "valid-case", "input": case, "digest": P.case_digest(case)})
reviewed = dict(case, provenance=dict(case["provenance"], author="someone else"), validation={"status": "validated"})
vectors.append({"kind": "caseDigest", "name": "author-and-review-excluded", "input": reviewed, "digest": P.case_digest(reviewed)})
for name, changed in [
    ("criticality-included", dict(case, criticality="critical")),
    ("slices-included", dict(case, slices={"language": "fr"})),
    ("selection-included", dict(case, provenance=dict(case["provenance"], selection="random"))),
    ("exposure-included", dict(case, provenance=dict(case["provenance"], exposure="sealed"))),
    ("data-class-included", dict(case, dataClass="personal")),
]:
    vectors.append({"kind": "caseDigest", "name": name, "input": changed, "digest": P.case_digest(changed)})
# One vector per provenance arm, and one per provenance member that decides the digest. The lists
# below are written by hand and checked here against the projection: a member listed as included
# must change the digest, and one listed as excluded must not. They do not read the rule file.
def provenance(**members):
    return dict(case, provenance=dict(case["provenance"], **members))


generated_with = {"method": "template expansion", "model": "generator-1", "seedSource": "fixed"}
reused_with = {"name": "public support questions", "version": "2", "limits": "English only"}
arms = {
    "authored": case,
    "generated": provenance(source="generated", generator=generated_with),
    "reused": provenance(source="reused", reusedDataset=reused_with),
    "collected": provenance(source="collected", collected="2026-10-20"),
    "promoted": provenance(source="promoted", finding="finding-17"),
}
for arm, record in arms.items():
    vectors.append({"kind": "caseDigest", "name": f"provenance-{arm}", "input": record, "digest": P.case_digest(record)})
included = [
    ("generator-method-included", arms["generated"], provenance(source="generated", generator=dict(generated_with, method="paraphrase"))),
    ("generator-model-included", arms["generated"], provenance(source="generated", generator=dict(generated_with, model="generator-2"))),
    ("generator-seed-source-included", arms["generated"], provenance(source="generated", generator=dict(generated_with, seedSource="clock"))),
    ("reused-dataset-name-included", arms["reused"], provenance(source="reused", reusedDataset=dict(reused_with, name="other dataset"))),
    ("reused-dataset-version-included", arms["reused"], provenance(source="reused", reusedDataset=dict(reused_with, version="3"))),
    ("reused-dataset-limits-included", arms["reused"], provenance(source="reused", reusedDataset=dict(reused_with, limits="German only"))),
    ("collected-date-included", arms["collected"], provenance(source="collected", collected="2026-10-21")),
    ("finding-included", arms["promoted"], provenance(source="promoted", finding="finding-18")),
    ("created-date-included", case, provenance(created="2026-11-02")),
    ("licence-included", case, provenance(licence="MIT")),
    ("source-included", provenance(collected="2026-10-20"), provenance(source="collected", collected="2026-10-20")),
]
for name, base, changed in included:
    assert P.case_digest(changed) != P.case_digest(base), name
    vectors.append({"kind": "caseDigest", "name": name, "input": changed, "digest": P.case_digest(changed)})
excluded = [
    ("author-excluded", case, provenance(author="another person")),
    ("review-status-excluded", case, dict(case, validation={"status": "suspect", "note": "checked"})),
    ("case-set-pointer-excluded", case, dict(case, caseSet="another-set")),
    ("case-without-case-set-pointer", case, {k: v for k, v in case.items() if k != "caseSet"}),
]
for name, base, changed in excluded:
    assert P.case_digest(changed) == P.case_digest(base), name
    vectors.append({"kind": "caseDigest", "name": name, "input": changed, "digest": P.case_digest(changed)})
proto = dict(case, input=dict(case["input"], **{"__proto__": "data, not a prototype"}))
vectors.append({"kind": "caseDigest", "name": "proto-member-in-input", "input": proto, "digest": P.case_digest(proto)})

case_set = json.loads((root / "valid" / "caseSet.json").read_text(encoding="utf-8"))
vectors.append({"kind": "caseSetDigest", "name": "valid-case-set", "input": case_set["cases"], "digest": P.case_set_digest(case_set["cases"])})
unicode_entries = [{"id": "b-2", "digest": "sha256:" + "1" * 64, "pool": "sealed"}, {"id": "Z-1", "digest": "sha256:" + "2" * 64, "pool": "development", "family": "f"}, {"id": "a-3", "digest": "sha256:" + "3" * 64, "pool": "validation"}, {"id": "9.x", "digest": "sha256:" + "4" * 64, "pool": "promoted"}]
vectors.append({"kind": "caseSetDigest", "name": "mixed-case-ids", "input": unicode_entries, "digest": P.case_set_digest(unicode_entries)})

out = {"oracle": f"python rfc8785 {rfc8785.__version__ if hasattr(rfc8785, '__version__') else '0.1.4'}", "vectors": vectors}
(root / "digests.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {len(vectors)} vectors")


# 1,000 generated vectors: doubles over the whole range, arbitrary Unicode member names and strings.
# Random generation differs between Python versions, so they are rewritten only on request.
if "--generated" not in sys.argv:
    sys.exit(0)
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
