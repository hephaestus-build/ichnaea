"""The digest projections, written independently of Ichnaea's TypeScript. The member lists come
from fixtures/digest-rules.json, which is generated from DIGEST_RULES (their one home). The
projection logic, the sorting and the canonical form (the `rfc8785` package) are this oracle's own.
"""
import hashlib
import json

import rfc8785


def digest(value):
    return "sha256:" + hashlib.sha256(rfc8785.dumps(value)).hexdigest()


def text_digest(text):
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def utf16_key(text):
    return text.encode("utf-16-be")


class Projections:
    def __init__(self, root):
        self.rules = json.loads((root / "digest-rules.json").read_text(encoding="utf-8"))

    def pick(self, record, rule):
        members = self.rules[rule]["members"]
        known = set(members) | set(self.rules[rule]["excluded"])
        # An unknown member is an error before hashing: a misspelt or misplaced member must not
        # leave a digest unchanged.
        unknown = sorted(set(record) - known)
        if unknown:
            raise ValueError(f"unknown members {unknown}")
        return {k: record[k] for k in members if k in record}

    def case_digest(self, case):
        projection = self.pick(case, "case")
        projection["provenance"] = self.pick(case["provenance"], "provenance")
        return digest(projection)

    def configuration_identity(self, config):
        projection = self.pick(config, "configuration")
        for prompt in config["prompts"]:
            if "template" in prompt and text_digest(prompt["template"]) != prompt["digest"]:
                raise ValueError(f"template of prompt {prompt['name']} does not match its digest")
        for key, field in (("models", "role"), ("parameters", "name"), ("prompts", "name")):
            names = [item[field] for item in config[key]]
            if len(set(names)) != len(names):
                raise ValueError(f"duplicate {field} in {key}")
        projection["models"] = sorted(config["models"], key=lambda m: utf16_key(m["role"]))
        projection["parameters"] = sorted(config["parameters"], key=lambda p: utf16_key(p["name"]))
        prompts = [self.pick(p, "prompt") for p in config["prompts"]]
        projection["prompts"] = sorted(prompts, key=lambda p: utf16_key(p["name"]))
        return digest(projection)

    def case_set_digest(self, entries):
        projected = [self.pick(e, "caseSetEntry") for e in entries]
        return digest(sorted(projected, key=lambda e: utf16_key(e["id"])))

    def compute(self, vector):
        """The digest of a projection vector, or "" when the projection refuses its input."""
        try:
            if vector["kind"].startswith("configurationIdentity"):
                return self.configuration_identity(vector["input"])
            if vector["kind"].startswith("caseDigest"):
                return self.case_digest(vector["input"])
            if vector["kind"].startswith("caseSetDigest"):
                return self.case_set_digest(vector["input"])
        except ValueError:
            return ""
        raise ValueError(f"unknown vector kind {vector['kind']}")
