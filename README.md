# Ichnaea

[![CI status on main](https://github.com/hephaestus-build/ichnaea/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hephaestus-build/ichnaea/actions/workflows/ci.yml?query=branch%3Amain)
[![OpenSSF Scorecard](https://img.shields.io/ossf-scorecard/github.com/hephaestus-build/ichnaea?label=OpenSSF%20Scorecard&style=flat)](https://scorecard.dev/viewer/?uri=github.com/hephaestus-build/ichnaea)
[![MIT licence](https://img.shields.io/github/license/hephaestus-build/ichnaea?style=flat)](./LICENSE)

Ichnaea evaluates GenAI features whenever their configuration changes: code, prompts, the model,
its parameters or the application's settings. It gives each change a clear verdict from paired
statistics, and says plainly when the cases cannot decide.

> **Status: early development.** Releases are paused: you pin a commit of this repository as a git
> submodule. Interfaces can change in any commit.

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

| Package                               | Content                                                                                                                                 | State     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `@hephaestus-build/ichnaea-contracts` | zod schemas, the normative JSON Schema 2020-12 files, shared fixtures, RFC 8785 canonical hashing, configuration identity, data classes | available |
| `@hephaestus-build/ichnaea-stats`     | Intervals, paired and stratified tests, power. The regression test is validated; non-inferiority is not, until the margin floor is set  | available |
| `@hephaestus-build/ichnaea-core`      | Plugin host, lifecycle, planner, import mode, file store, call ledger, CLI                                                              | available |
| `@hephaestus-build/ichnaea-decide`    | Decision rule with its power statement, and the `decide` command                                                                        | available |
| `@hephaestus-build/ichnaea-report`    | Markdown and HTML reports with an interval lint, and the `report` command                                                               | available |
| `@hephaestus-build/ichnaea-runner`    | Runner                                                                                                                                  | planned   |
| `@hephaestus-build/ichnaea-testkit`   | Conformance kits                                                                                                                        | planned   |

All packages have the same version. They ship their TypeScript sources, with no build step, and need
Node 24 or later, which runs TypeScript with its type stripping. zod 4 (4.6 or later) is a peer
dependency.

## Use Ichnaea from a TypeScript project

Add this repository to your project as a git submodule, pinned to a commit, and link its packages
into your pnpm workspace. Node runs the sources from the submodule. Node does not strip types from
files under `node_modules`, so a package copied there, for example from a packed tarball, does not
run. A workspace link resolves to the submodule, so the sources run there.

Add the submodule and pin it to a commit:

```sh
git submodule add https://github.com/hephaestus-build/ichnaea vendor/ichnaea
git -C vendor/ichnaea checkout <commit>
git add .gitmodules vendor/ichnaea
git commit -m "build: pin ichnaea to <commit>"
```

List its packages in `pnpm-workspace.yaml`, beside your own entries:

<!-- The submodule consumer test writes this file. -->

```yaml
packages:
  - vendor/ichnaea/packages/*
```

Then, at the root of your workspace, add zod and the packages that you import. The five-minute
example below imports contracts, core, decide and report. The CLI loads `ichnaea.config.ts` as an
ES module:

<!-- The submodule consumer test runs this install. -->

```sh
pnpm pkg set type=module
pnpm add -w zod@4.6.7 \
  '@hephaestus-build/ichnaea-contracts@workspace:*' \
  '@hephaestus-build/ichnaea-core@workspace:*' \
  '@hephaestus-build/ichnaea-decide@workspace:*' \
  '@hephaestus-build/ichnaea-report@workspace:*'
```

zod at the root is the one copy that every Ichnaea package uses. Run the CLI with Node 24 or later:
`pnpm exec ichnaea <command>` runs `node vendor/ichnaea/packages/core/src/bin.ts <command>`.

### Update the pin

```sh
git -C vendor/ichnaea fetch
git -C vendor/ichnaea checkout <commit>
git add vendor/ichnaea
git commit -m "build: update ichnaea to <commit>"
```

Then run `pnpm install`, so that the workspace links the packages of the new commit.

### Why the pin is the integrity

Your repository records the commit hash of the submodule, and the hash fixes every file of that
commit. Every commit on every branch of this repository is signed: the repository refuses a push
with an unsigned commit. Before you pin or update, check the commit's signature. Use
`git -C vendor/ichnaea verify-commit HEAD`, which needs the signer's public key, or look for the
**Verified** badge on the commit on GitHub.

## Five-minute example

[`examples/support-assistant`](examples/support-assistant/README.md) is a synthetic support
assistant. Another runner wrote its results. Ichnaea imports them, decides and reports, with no
model call. In the project where you linked the packages, copy the example from the submodule.
Then import, decide and report two candidates against the same base. Each candidate is a
new model with a new prompt: the trigger is `new-model`, and `--vary prompt.answer` declares the
prompt change.

<!-- The submodule consumer test runs this example. -->

```sh
example=vendor/ichnaea/examples/support-assistant
cp -R "$example/ichnaea.config.ts" "$example/plugin.ts" "$example/data" "$example/configurations" "$example/results" .
# An unchanged candidate
pnpm exec ichnaea import --importer support/results \
  --suite data/suite.json --case-set data/case-set.json --cases data/cases.jsonl \
  --arm base:base:configurations/base.json --arm candidate:candidate:configurations/candidate.json \
  --file results/base.json --file results/candidate-same.json \
  --trigger new-model --vary prompt.answer --run unchanged
pnpm exec ichnaea decide --run unchanged
pnpm exec ichnaea report --run unchanged
# A regressed candidate
pnpm exec ichnaea import --importer support/results \
  --suite data/suite.json --case-set data/case-set.json --cases data/cases.jsonl \
  --arm base:base:configurations/base.json --arm candidate:candidate:configurations/candidate.json \
  --file results/base.json --file results/candidate-regressed.json \
  --trigger new-model --vary prompt.answer --run regressed
pnpm exec ichnaea decide --run regressed
pnpm exec ichnaea report --run regressed
```

`decide` prints the verdict line and exits by the CI policy of the plan: 1 blocks the change.

<!-- The submodule consumer test checks these verdict lines and exit codes. -->

| Scenario               | Results file                       | `decide` prints                                                                                                                         | `decide` exits |
| ---------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| An unchanged candidate | `results/candidate-same.json`      | `INCONCLUSIVE: No primary measure regressed, but no candidate can PASS yet: the validated margin floor for non-inferiority is not set.` | 0              |
| A regressed candidate  | `results/candidate-regressed.json` | `REGRESSION: Measure support/facts-stated dropped beyond run-to-run noise and is not shown non-inferior.`                               | 1              |

INCONCLUSIVE is the expected result for the unchanged candidate today. It does not mean that the
setup is broken. A real drop already gives REGRESSION. PASS needs a validated non-inferiority
result, and that needs a validated margin floor, which is not set yet (see
[the statistics validation](packages/stats/VALIDATION.md)). The example's policy reports
INCONCLUSIVE and does not block, so `decide` exits with 0.

`report` writes `summary.md` and a self-contained `report.html` to
`.ichnaea/runs/<run>/report/`. The store, `.ichnaea/`, keeps every record of the run.

## Contracts for any language

Records cross every boundary as JSON. The JSON Schema files in
[`packages/contracts/schemas`](packages/contracts/schemas) are the normative contract. They are
generated from the zod sources. CI runs a shared fixture set and generated records through zod and
ajv, for the writer and the reader schemas, and checks digests against an implementation in another
language. An application in any language can write records that validate against them.

## Develop

Developing Ichnaea needs Node 24 or later and pnpm. There is no build: tests, the CLI and the
scripts run the TypeScript sources.

```sh
pnpm install
pnpm check                            # format, lint, type check, tests, generated files current
node scripts/submodule-consumer.ts    # the README's install and example in a consumer workspace
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Code is [MIT](LICENSE). This includes the zod sources, the generated JSON Schemas and the fixtures.
Specification text and documentation are [CC BY 4.0](LICENSE-docs.md).
