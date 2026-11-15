# 0003. What a configuration identity hashes

Status: Accepted
Date: 2026-11-15

## Context

The identity of a configuration says which system a trial ran. It is stored in plans, runs and
trials.

The first version hashed a prompt's `template` text and its `uri`. The same configuration, declared
once by digest and once with the text, then got two identities. A template that contradicted its own
digest still validated.

## Decision

The identity hashes a fixed projection of the configuration:

- `models`, `parameters`, `prompts` and `factors`;
- of each prompt: `name`, `digest` and `status`.

It leaves out these members:

- `schema`: a new major version that keeps the projection keeps the identities. A major that
  changes the projection is listed in `majors.json`, and its migration recomputes the identities.
- `description`: prose for people. It stays recorded.
- `label`: a name for people.
- `informational`: values that do not decide behaviour, such as a provider fingerprint seen at
  resolution.
- a prompt's `template`: the text that `digest` pins.
- a prompt's `uri`: where the template was resolved from.

A prompt's `digest` is the SHA-256 of its template's UTF-8 bytes as written. When a template is
present, its digest must match the declared digest. `verifyConfiguration` and `verifyArms` report a
mismatch, and `configurationIdentity` refuses the configuration. A template with a lone surrogate
has no UTF-8 form, so it never matches.

A schema cannot compare a template with a digest. Validation by schema alone does not check it.

The projection and the reason for each exclusion are in `DIGEST_RULES`, in
`packages/contracts/src/identity.ts`. This is their one home.

## Evidence

- Two committed vectors, one for a configuration with its template and URI and one for the same
  configuration declared by digest, have one identity. A Python implementation that shares no code
  with the package recomputes both in CI.
- 4 refusal vectors (an unknown top-level member, an unknown prompt member, a template that
  contradicts its digest, a template whose digest is of the trimmed text) are refused by both
  implementations.
- A test changes each hashed member and each excluded member of a configuration, one by one, and
  checks that the identity changes or stays. It also changes every leaf of generated
  configurations. The expected result comes from a list that the test holds by hand.
- The plan fixture has a template that ends with a newline, so a change that trims the text
  before hashing fails a test.

## Consequences

- A configuration has one identity, whether it carries its template text or only its digest.
- Editing a description or a label never changes an identity.
- A reader that trusts a recorded template must call `verifyConfiguration` or `verifyArms`.
  Reading a record does not.
