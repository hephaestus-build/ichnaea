# Ichnaea

Ichnaea evaluates GenAI features whenever their configuration changes: code, prompts, the model,
its parameters or the application's settings. It gives each change a clear verdict from paired
statistics, and says plainly when the cases cannot decide.

> **Status: early development.** Nothing is published yet. Interfaces change without notice until
> the first release. The contracts and the statistics core come first.

## What it is built to do

- **Evaluates a whole system configuration.** Code, prompts, model, parameters, tools and settings
  resolve to one record with an identity. Any change to it is a trigger.
- **Decides with paired statistics.** A change is compared with its base on the same cases, with
  intervals, per-case flips and a stated estimand. The verdict is PASS, REGRESSION, INCONCLUSIVE or
  INVALID. Before a run, the planner prints the smallest change the suite can detect.
- **Keeps every planned trial.** Failures, abstentions and missing data stay visible. A skipped or
  over-budget run is never a pass.
- **Treats a model judge as an instrument.** A judge gates only when it agrees with people on the
  task, and its uncertainty carries into the result.
- **Keeps data where it lives.** Every record field has a data class and a purpose allow-list.
  Commands that move data are built to let only data classed `none` leave by default.
- **Measures systems, never people.** No measure has a person as its subject. Agreement per rater
  exists only inside calibration records, under pseudonyms.

Ichnaea is a TypeScript library and CLI. It runs in your CI and inside your deployment, and listens
on no network port. It reuses proven tools (OpenTelemetry, Prometheus and Grafana, Langfuse,
Inspect's log format) instead of building its own store, dashboard or labelling server.

## Packages

| Package                                                              | Content                                                                                                                                 | State          |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `@hephaestus-build/ichnaea-contracts`                                | zod schemas, the normative JSON Schema 2020-12 files, shared fixtures, RFC 8785 canonical hashing, configuration identity, data classes | in development |
| `@hephaestus-build/ichnaea-stats`                                    | Intervals, paired tests, power, validated by simulation                                                                                 | planned        |
| `@hephaestus-build/ichnaea-core`                                     | Plugin host, lifecycle, file store, CLI                                                                                                 | planned        |
| `@hephaestus-build/ichnaea-decide`, `-report`, `-runner`, `-testkit` | Decision rule, reports, runner, conformance kits                                                                                        | planned        |

## Contracts for any language

Records cross every boundary as JSON. The JSON Schema files in
[`packages/contracts/schemas`](packages/contracts/schemas) are the normative contract. They are
generated from the zod sources. CI runs a shared fixture set and generated records through zod and
ajv, for the writer and the reader schemas, and checks digests against an implementation in another
language. An application in any language can write records that validate against them.

## Develop

The packages need Node 22.12 or later. Developing Ichnaea needs Node 22.18 or later (the repository
scripts run TypeScript directly) and pnpm.

```sh
pnpm install
pnpm check      # format, lint, type check, tests, generated files current
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Code is [MIT](LICENSE). This includes the zod sources, the generated JSON Schemas, fixtures and agent
skills. Specification text and documentation are [CC BY 4.0](LICENSE-docs.md).
