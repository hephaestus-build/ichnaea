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

- `<name>.schema.json` is the **writer** schema. Write only records that validate against it.
- `<name>.reader.schema.json` is the **reader** schema. It accepts string values that a later minor
  version adds to an enumeration, and keeps the known values as the `x-ichnaea-known` annotation.
  A reader must treat such a value as unknown. Discriminators (`const`) and the `schema` field stay
  strict: a new kind is a new major version.

Both accept unknown members. Readers ignore them.

In TypeScript, `readRecord(contract, value)` reads tolerantly and reports unknown values.

The schemas use three annotation keywords. Register them with your validator, for example in ajv:

```ts
ajv.addKeyword({ keyword: "x-ichnaea-data", schemaType: "object" });
ajv.addKeyword({ keyword: "x-ichnaea-stability", schemaType: "string" });
ajv.addKeyword({ keyword: "x-ichnaea-known", schemaType: "array" });
```

## Hashing (normative)

A digest is `sha256:` followed by the lowercase hex SHA-256 of the UTF-8 bytes of the record's
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) canonical form. Strings must be well-formed
Unicode, and numbers must be finite.

| Digest                 | Projection before hashing                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Case digest            | The case with only the members of `ichnaea.case/1`                                                                                                                                                                      |
| Case-set digest        | The entries, each with `id`, `digest`, `pool` and `family` where present, sorted by `id` (UTF-16 code units). IDs are unique.                                                                                           |
| Configuration identity | The configuration with only the members of `ichnaea.configuration/1`, without `label`, with `models` sorted by `role`, and `parameters` and `prompts` sorted by `name` (UTF-16 code units). Roles and names are unique. |

The writer computes an identity and stores it in plans and trials. Readers compare stored
identities. They never recompute an identity from a record that has members they do not know.

[`fixtures/digests.json`](fixtures/digests.json) holds vectors computed by an implementation in
another language. A new implementation must reproduce them.

## Data policies

Every field carries an `x-ichnaea-data` annotation: its data class (`none`, `pseudonymous`,
`personal`, `special`, or `inherit` for content whose class the record declares in `dataClass`),
its identifier kind, the purposes it may leave for, and its retention rule. `projectForEgress`
keeps only the fields that a destination may receive for one purpose, and drops unknown,
unclassified and off-schema values.

## Fixtures

[`fixtures/`](fixtures) holds a valid record per contract, invalid variants that every writer
validator must reject, reader-only variants that readers must accept, and the digest vectors.

## Licence

MIT. The specification text is CC BY 4.0.
