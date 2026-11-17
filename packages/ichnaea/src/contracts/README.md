# Contracts: `@hephaestus-build/ichnaea/contracts`

The record contracts of Ichnaea: zod schemas, the normative JSON Schema 2020-12 files, shared
fixtures, RFC 8785 canonical hashing, the configuration identity and data policies.

Records cross every boundary as JSON. Any language can take part by writing JSON that validates
against the schema files in [`schemas/`](../../schemas).

## Records

| Schema ID                                                               | File                          | Holds                                                      |
| ----------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| `ichnaea.case/1`                                                        | `case.schema.json`            | One evaluation input with fixtures and hidden references   |
| `ichnaea.caseSet/1`                                                     | `caseSet.schema.json`         | A versioned collection of cases, identified by a digest    |
| `ichnaea.configuration/1`                                               | `configuration.schema.json`   | A resolved system configuration with factor statuses       |
| `ichnaea.suite/1`                                                       | `suite.schema.json`           | What an application evaluates, without naming a system     |
| `ichnaea.plan/1`                                                        | `plan.schema.json`            | The resolved, locked form of a suite for one run           |
| `ichnaea.trial/1`                                                       | `trial.schema.json`           | The normalised evidence of one trial                       |
| `ichnaea.run/1`                                                         | `run.schema.json`             | The ledger of a plan's trials with lineage                 |
| `ichnaea.measureCard/1`                                                 | `measureCard.schema.json`     | The definition of a measure                                |
| `ichnaea.measureValue/1`                                                | `measureValue.schema.json`    | One measured value on one trial                            |
| `ichnaea.decision/1`                                                    | `decision.schema.json`        | The verdict of one run with estimates, intervals and flips |
| `ichnaea.judge/1`, `label/1`, `calibration/1`, `monitor/1`, `finding/1` |                               | In development                                             |
| `ichnaea.suite/2`                                                       | `suite.2.schema.json`         | One thing you evaluate, as plain data (alpha)              |
| `ichnaea.configuration/2`                                               | `configuration.2.schema.json` | An arm's configuration file, by digest (alpha)             |
| `ichnaea.project/1`                                                     | `project.1.schema.json`       | The project config that several suites share (alpha)       |
| `ichnaea.suite.lock/1`                                                  | `suite.lock.schema.json`      | The digests that pin a suite, written by `lock` (alpha)    |

`suite/2`, `configuration/2`, `ichnaea.project/1` and `suite.lock/1` are the records of the next
framework. A suite or project file (`suite.ts` or `suite.jsonc`, `ichnaea.config.ts` or
`ichnaea.config.jsonc`) loads into one of them. A TypeScript measure is a module reference
(`{ instrument, module, export }`), never a function value.

- **Plain data.** The schemas validate JSON values. zod drops an `undefined` member and reads a
  class instance as an object, so a record alone cannot refuse a value that is not plain data.
  The loader refuses it first: `plainDataProblems(value)` names every such field by its path.
- **Editors.** A JSONC file points its editor at `suite.2.schema.json` or `project.1.schema.json`
  with `$schema`. The file name carries the major, so the pointer never changes meaning.
- **Digests.** `suiteDigest` and `projectDigest` hash the canonical JSON without `$schema`, so the
  TypeScript and JSONC forms of one file share a digest. `configuration/2.digest` is over the
  canonical JSON of the arm's configuration file, never its raw bytes.
- **Checks beyond the schema.** `suiteProblems(suite)` lists the rules of a parsed suite that a
  JSON Schema cannot express, each with a named code, and `lock` refuses a suite with any. A
  secondary measure that attribute compares needs its own fidelity margin
  (`FIDELITY_MARGIN_MISSING`): only a primary measure has a registered limit, inside (0, 1), whose
  half is the default. A level measure's levels are strictly ascending, its `cut` is one of them
  and above the lowest, and each `anchors` key is one of them (`LEVELS_NOT_ASCENDING`,
  `LEVEL_CUT_NOT_A_LEVEL`, `LEVEL_CUT_AT_LOWEST`, `LEVEL_ANCHOR_NOT_A_LEVEL`).
- **Level scale.** A level measure with `spacing: "equal"` is tested as a score on
  (level − min)/(max − min). Its limits, fidelity margins and the ±0.15 arm-bias bound live on
  [0, 1], so a limit means the same for levels 1–5 as for 0–3. A scorer reports a level by its
  value.
- **Two majors.** `suite/1` and `configuration/1` stay registered beside `suite/2` and
  `configuration/2` while the planner and the importer still read them. The newer major needs no
  migration until the older one leaves the registry (`majors.json`).

## Writer and reader schemas

Each record has two schema files, named by the contract's `file` stem when it has one (`project.1`)
and by its name otherwise (`schemaFileName`):

- `<name>.schema.json` is the **writer** schema. It is strict: an unknown member is an error, so a
  misspelt or misplaced member never passes unnoticed and never leaves an identity unchanged.
- `<name>.reader.schema.json` is the **reader** schema. It accepts unknown members, a string
  that a later minor version adds to an open enumeration (the known values stay as the
  `x-ichnaea-known` annotation), and a kind that a later minor version adds to a tagged union (the
  fallback option, marked `x-ichnaea-unknown-kind`, takes only kinds no known option names). A
  reader must treat such values as unknown. Closed enumerations (`x-ichnaea-closed`: the
  non-finite values and the trial outcomes) and the `schema` field stay strict: a new major version is a new schema, and
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
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) canonical form. Each digest hashes a projection
of its record. `DIGEST_RULES` in [`identity.ts`](identity.ts) is the one home of the
projections: per record, the members hashed and the members excluded, each with its reason. Other
languages read the same rules from [`fixtures/digest-rules.json`](../../fixtures/digest-rules.json).

| Digest                 | Projection                                                                                                       | Then                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Case digest            | the case without its ID, pool, review status and case set pointer, and its provenance without the author pointer | —                                                                                     |
| Case-set digest        | each entry's `id`, `digest`, `pool`, `family`                                                                    | sort entries by `id` (UTF-16 code units); IDs unique, at least one                    |
| Configuration identity | `models`, `parameters`, `factors`, and of each prompt its `name`, `digest` and `status`                          | sort `models` by `role`, `parameters` and `prompts` by `name`; roles and names unique |

A projection keeps the listed members as written. Their values are hashed whole, so a member that a
later minor version adds inside a hashed value changes the digest. A member added at a projected
level stays out until a rule lists it, which is a new major version. A reader can compute a digest
only from a record its strict writer schema accepts: an unknown member is an error, never ignored,
so an older reader refuses a record with a newer member instead of computing a different digest.

A member named `__proto__` is data like any other member. A record that validates but has no
canonical form (a string with a lone surrogate) gets an `IdentityError`. Resolvers normalise what
JCS does not: Unicode normalisation form (NFC and NFD spell different identities), and the order of
list-valued factor values, which counts.

The rules are defined for the `/1` records, and `schema` does not enter a digest. A new major
version states its own rules in its migration.

A prompt's `digest` is the SHA-256 of its template's UTF-8 bytes as written, a trailing newline
included. A template with a lone surrogate has no UTF-8 form, so it never matches a digest. The
template text and its `uri` are recorded but not hashed, so a configuration resolved with the text
and one declared by digest alone have one identity.

A schema cannot compare a template with a digest, so validating a record against its schema, or
reading it with `readRecord`, does not check it. `verifyConfiguration` checks a recorded template
against its digest, and `configurationIdentity` refuses a configuration whose template does not
match. A reader that trusts a recorded template must call one of them.

The writer computes an identity and stores it in plans, runs and trials. `verifyArms` checks a
stored identity against its configuration, and the configuration's templates against their digests.
It reports every problem as a `LinkError`, including an arm that is not a valid configuration or
that has no identity (no `models`, a duplicate role), and does not throw.

Decisions 0002 and 0003 in [`docs/decisions`](../../../../docs/decisions) give the reasons for the case
digest and the configuration identity.

[`fixtures/digests.json`](../../fixtures/digests.json) holds vectors for every digest and projection,
and [`fixtures/digests-generated.json`](../../fixtures/digests-generated.json) 1,000 generated values
(doubles over the whole range, any Unicode). Both come from an implementation in Python that
shares no code with this package (`scripts/contracts/oracle/`). CI recomputes every vector, the projections
included, and fails on any difference. A new implementation must reproduce them.

The Python code checks the projection logic, the sort order and the canonical form independently.
It does not check which members a projection keeps: it reads those lists from
`fixtures/digest-rules.json`, which is generated from `DIGEST_RULES`. The committed vectors pin the
lists instead. They hold one case per provenance arm and one change per hashed member, so a member
that leaves a digest changes a recomputed vector and fails CI until the vectors are regenerated and
the change is reviewed.

## Data policies

Every field carries an `x-ichnaea-data` annotation: its data class (`none`, `pseudonymous`,
`personal`, `special`, or `inherit` for content and attributes whose class the record declares in
`dataClass`), its identifier kind, the purposes (PU-1 to PU-6) it may leave for, and its retention
rule (`record`, or `subject`: erased with the person). `projectForEgress` keeps only the fields that
a destination may receive for one purpose, and drops unknown, unclassified and off-schema values.
A deployment can grant more purposes for named fields, never a higher class.

## Fixtures

[`fixtures/`](../../fixtures) holds a valid record per contract, invalid variants that every writer
validator must reject, reader-only variants that readers must accept, and the digest vectors.

## API

The public API is recorded in [`api/ichnaea-contracts.api.md`](../../api/ichnaea-contracts.api.md)
(API Extractor). CI fails when the API changes without the report.

## Licence

MIT. The specification text is CC BY 4.0.
