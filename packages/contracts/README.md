# @hephaestus-build/ichnaea-contracts

The record contracts of Ichnaea: zod schemas, the normative JSON Schema 2020-12 files, shared
fixtures, RFC 8785 canonical hashing, the configuration identity and data policies.

Records cross every boundary as JSON. Any language can take part by writing JSON that validates
against the schema files in [`schemas/`](schemas).

## Records

| Schema ID                                                               | File                        | Holds                                                      |
| ----------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------- |
| `ichnaea.case/1`                                                        | `case.schema.json`          | One evaluation input with fixtures and hidden references   |
| `ichnaea.caseSet/1`                                                     | `caseSet.schema.json`       | A versioned collection of cases, identified by a digest    |
| `ichnaea.configuration/1`                                               | `configuration.schema.json` | A resolved system configuration with factor statuses       |
| `ichnaea.suite/1`                                                       | `suite.schema.json`         | What an application evaluates, without naming a system     |
| `ichnaea.plan/1`                                                        | `plan.schema.json`          | The resolved, locked form of a suite for one run           |
| `ichnaea.trial/1`                                                       | `trial.schema.json`         | The normalised evidence of one trial                       |
| `ichnaea.run/1`                                                         | `run.schema.json`           | The ledger of a plan's trials with lineage                 |
| `ichnaea.measureCard/1`                                                 | `measureCard.schema.json`   | The definition of a measure                                |
| `ichnaea.measureValue/1`                                                | `measureValue.schema.json`  | One measured value on one trial                            |
| `ichnaea.decision/1`                                                    | `decision.schema.json`      | The verdict of one run with estimates, intervals and flips |
| `ichnaea.judge/1`, `label/1`, `calibration/1`, `monitor/1`, `finding/1` |                             | In development                                             |

## Writer and reader schemas

Each record has two schema files:

- `<name>.schema.json` is the **writer** schema. It is strict: an unknown member is an error, so a
  misspelt or misplaced member never passes unnoticed and never leaves an identity unchanged.
- `<name>.reader.schema.json` is the **reader** schema. It accepts unknown members, a string
  that a later minor version adds to an open enumeration (the known values stay as the
  `x-ichnaea-known` annotation), and a kind that a later minor version adds to a tagged union (the
  fallback option, marked `x-ichnaea-unknown-kind`, takes only kinds no known option names). A
  reader must treat such values as unknown. Closed enumerations (`x-ichnaea-closed`, the
  non-finite values) and the `schema` field stay strict: a new major version is a new schema, and
  it ships with a migration (`majors.json`).

In TypeScript, `readRecord(contract, value)` validates against the reader schema (zod builds it
from the same JSON Schema, so the two agree), reports unknown values in `unknownValues` and
unknown members in `unknownMembers`, and types the result so that code must handle them.

Strings must be well-formed Unicode and numbers finite. A writer in a language that can emit `NaN`
or `Infinity` in JSON (Python's `json.dumps` does by default) must refuse them: encode a non-finite
result as `{ "nonFinite": "nan" | "inf" | "-inf" }`.

Register the annotation keywords with your validator, for example in ajv:

```ts
for (const keyword of ["x-ichnaea-data", "x-ichnaea-known"]) ajv.addKeyword({ keyword });
ajv.addKeyword({ keyword: "x-ichnaea-stability", schemaType: "string" });
for (const keyword of ["x-ichnaea-unknown-kind", "x-ichnaea-closed"])
  ajv.addKeyword({ keyword, schemaType: "boolean" });
```

## Hashing (normative)

A digest is `sha256:` followed by the lowercase hex SHA-256 of the UTF-8 bytes of an
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) canonical form. A digest covers the record as
written, restricted to a frozen list of top-level members. Nested values are hashed whole. So every
reader, of any minor version and in any language, computes the same digest from the same bytes. A
member added to a record later enters a digest only through a change to this list, which is a new
major version.

| Digest                 | Members                                                  | Then                                                                                  |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Case digest            | `id`, `unit`, `input`, `turns`, `fixtures`, `references` | —                                                                                     |
| Case-set digest        | each entry's `id`, `digest`, `pool`, `family`            | sort entries by `id` (UTF-16 code units); IDs unique, at least one                    |
| Configuration identity | `models`, `parameters`, `prompts`, `factors`             | sort `models` by `role`, `parameters` and `prompts` by `name`; roles and names unique |

The record must validate against its strict writer schema first, so an unknown member is an error,
never ignored. A member named `__proto__` is data like any other member. A record that validates
but has no canonical form (a string with a lone surrogate) gets an `IdentityError`. Resolvers
normalise what JCS does not: Unicode normalisation form (NFC and NFD spell different identities),
and the order of list-valued factor values, which counts. Provenance, pool, family and review status do not enter a case digest, so erasing
an author or reviewing a case keeps it. `description`, `label` and `informational` do not enter the
configuration identity: they describe the configuration for people. A provider fingerprint seen at
resolution time goes in `informational`; one seen per trial goes in `Trial.observed`. Neither
changes the identity.

The writer computes an identity and stores it in plans, runs and trials. `verifyArms` checks a
stored identity against its configuration.

[`fixtures/digests.json`](fixtures/digests.json) holds vectors for every digest and projection,
and [`fixtures/digests-generated.json`](fixtures/digests-generated.json) 1,000 generated values
(doubles over the whole range, any Unicode). Both come from an independent implementation in
Python (`scripts/oracle/`, regenerated and compared in CI). A new implementation must reproduce
them.

## Data policies

Every field carries an `x-ichnaea-data` annotation: its data class (`none`, `pseudonymous`,
`personal`, `special`, or `inherit` for content and attributes whose class the record declares in
`dataClass`), its identifier kind, the purposes (PU-1 to PU-6) it may leave for, and its retention
rule (`record`, or `subject`: erased with the person). `projectForEgress` keeps only the fields that
a destination may receive for one purpose, and drops unknown, unclassified and off-schema values.
A deployment can grant more purposes for named fields, never a higher class.

## Fixtures

[`fixtures/`](fixtures) holds a valid record per contract, invalid variants that every writer
validator must reject, reader-only variants that readers must accept, and the digest vectors.

## API

The public API is recorded in [`api/ichnaea-contracts.api.md`](api/ichnaea-contracts.api.md)
(API Extractor). CI fails when the API changes without the report.

## Licence

MIT. The specification text is CC BY 4.0.
