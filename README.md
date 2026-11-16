# Ichnaea

[![CI status on main](https://github.com/hephaestus-build/ichnaea/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hephaestus-build/ichnaea/actions/workflows/ci.yml?query=branch%3Amain)
[![OpenSSF Scorecard](https://img.shields.io/ossf-scorecard/github.com/hephaestus-build/ichnaea?label=OpenSSF%20Scorecard&style=flat)](https://scorecard.dev/viewer/?uri=github.com/hephaestus-build/ichnaea)
[![MIT licence](https://img.shields.io/github/license/hephaestus-build/ichnaea?style=flat)](./LICENSE)

Ichnaea evaluates GenAI features whenever their configuration changes: code, prompts, the model,
its parameters or the application's settings. It gives each change a clear verdict from paired
statistics, and says plainly when the cases cannot decide.

> **Status: early development.** Ichnaea is 0.x: install a release from GitHub. Interfaces can
> change between releases. npm comes at 1.0.

## What it is built to do

- **Evaluates a whole system configuration.** Code, prompts, model, parameters, tools and settings
  resolve to one record with an identity. Any change to it is a trigger.
- **Decides with paired statistics.** A change is compared with its base on the same cases, with
  intervals, per-case flips and a stated estimand. The verdict is Pass, Regression, Inconclusive or
  Invalid. Before a run, the planner prints a power statement for the suite.
- **Keeps every planned trial.** Failures, abstentions and missing data stay visible. A skipped or
  over-budget run is never a pass.
- **Keeps data where it lives.** Ichnaea opens no network port and makes no network call of its
  own. It writes only to the store you name (`.ichnaea` by default), and every record field carries
  a data class.
- **Measures systems, never people.** No measure has a person as its subject.

Ichnaea is a TypeScript library and CLI. It runs in your CI and inside your deployment. Its records
are plain JSON files, and it runs no server, dashboard or labelling tool.

## Packages

Ichnaea is one package, `@hephaestus-build/ichnaea`. Its subpaths:

| Import                                                   | Content                                                                                                                                | State     |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `@hephaestus-build/ichnaea`                              | Plugin host, lifecycle, planner, import mode, file store, call ledger and CLI; the decision rule with its power statement; the reports | available |
| `@hephaestus-build/ichnaea/contracts`                    | zod schemas, RFC 8785 canonical hashing, configuration identity, data classes                                                          | available |
| `@hephaestus-build/ichnaea/stats`                        | Intervals, paired and stratified tests, power. The regression test is validated; non-inferiority is not, until the margin floor is set | available |
| `@hephaestus-build/ichnaea/schemas/<record>.schema.json` | The normative JSON Schema 2020-12 file of each record                                                                                  | available |
| Runner and conformance kits                              |                                                                                                                                        | planned   |

The package ships JavaScript and declarations, built from its TypeScript sources, and the sources
too. It needs Node 24.3 or later. zod 4 (4.6 or later) is a peer dependency. The package has no
other dependency.

## Use Ichnaea from a TypeScript project

Ichnaea is released as a package tarball on GitHub, with a provenance attestation. npm comes at
1.0. Ichnaea needs Node 24.3 or later, and your project must be an ES module project:

```sh
pnpm pkg set type=module
```

Then, at the root of your project, find the newest release, verify it, and add it with zod. The
check shows that the release workflow of this repository built the tarball, and it catches a
tarball that someone uploaded by hand, so do not skip it:

<!-- The build consumer test runs this install. -->

```sh
TAG=$(gh release view -R hephaestus-build/ichnaea --json tagName -q .tagName)
gh release download "$TAG" -R hephaestus-build/ichnaea -p 'hephaestus-build-ichnaea-*.tgz'
gh attestation verify "hephaestus-build-ichnaea-${TAG#v}.tgz" -R hephaestus-build/ichnaea \
  --signer-workflow hephaestus-build/ichnaea/.github/workflows/release.yml \
  --source-ref refs/heads/main --deny-self-hosted-runners
pnpm add zod@4.6.7 "https://github.com/hephaestus-build/ichnaea/releases/download/$TAG/hephaestus-build-ichnaea-${TAG#v}.tgz"
```

<!-- TODO-FROM-RELEASE: the output of a successful check, copied from the v0.1.0 run. -->

The check passes only for a tarball built by the release workflow on main.

pnpm records the concrete URL and its integrity hash in your lockfile. Releases are immutable, so
the URL always serves the bytes you verified. To pin an older release, set `TAG` by hand, for
example `TAG=v0.1.0`. zod is a peer dependency: 4.6 or later works, and 4.6.7 is the version
Ichnaea is tested with. Run the CLI with `pnpm exec ichnaea <command>`. Installing the package runs
no script: its `package.json` has none.

Each release also ships its SBOM, `sbom.cdx.json`, and `SHA256SUMS`, both attested.

### Update

Run the same block again: it finds, verifies and adds the newest release. If you need a fix before
the next release, ask for a patch release.

### Develop Ichnaea and your project together

In the Ichnaea checkout, build on every change:

```sh
pnpm --filter @hephaestus-build/ichnaea build --watch
```

In your project, link the package of that checkout instead of the release tarball:

```sh
pnpm link <path to the Ichnaea checkout>/packages/ichnaea
```

To undo it, run `pnpm unlink @hephaestus-build/ichnaea` and then `pnpm install`, so that your
lockfile's release is installed again. Stop the watch with Ctrl-C. Never commit the link: it
changes your `package.json` and lockfile to a path on your machine.

## Five-minute example

[`examples/support-assistant`](examples/support-assistant/README.md) is a synthetic support
assistant. Another runner wrote its results. Ichnaea imports them, decides and reports, with no
model call. In the project where you installed Ichnaea, copy the example from a clone of this
repository. Then import, decide and report two candidates against the same base. Each candidate is
a new model with a new prompt: the trigger is `new-model`, and `--vary prompt.answer` declares the
prompt change.

<!-- The build consumer test runs this example. -->

```sh
git clone --depth 1 https://github.com/hephaestus-build/ichnaea ichnaea-checkout
example=ichnaea-checkout/examples/support-assistant
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

`decide` prints the verdict line. Its exit code is 1 when the plan's policy says to stop, so a script
can act on it.

<!-- The build consumer test checks these verdict lines and exit codes. -->

| Scenario               | Results file                       | `decide` prints                                                                                                                         | `decide` exits |
| ---------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| An unchanged candidate | `results/candidate-same.json`      | `INCONCLUSIVE: No primary measure regressed, but no candidate can PASS yet: the validated margin floor for non-inferiority is not set.` | 0              |
| A regressed candidate  | `results/candidate-regressed.json` | `REGRESSION: Measure support/facts-stated dropped beyond run-to-run noise and is not shown non-inferior.`                               | 1              |

INCONCLUSIVE is the expected result for the unchanged candidate today. It does not mean that the
setup is broken. A real drop already gives REGRESSION. PASS needs a validated non-inferiority
result, and that needs a validated margin floor, which is not set yet (see
[the statistics validation](packages/ichnaea/src/stats/VALIDATION.md)). The example's policy reports
INCONCLUSIVE and does not block, so `decide` exits with 0.

`report` writes `summary.md` and a self-contained `report.html` to
`.ichnaea/runs/<run>/report/`. The store, `.ichnaea/`, keeps every record of the run.

## Contracts for any language

Records cross every boundary as JSON. The JSON Schema files in
[`packages/ichnaea/schemas`](packages/ichnaea/schemas) are the normative contract, and the package
exports them as `@hephaestus-build/ichnaea/schemas/<record>.schema.json`. They are
generated from the zod sources. CI runs a shared fixture set and generated records through zod and
ajv, for the writer and the reader schemas, and checks digests against an implementation in another
language. An application in any language can write records that validate against them.

## Develop

Developing Ichnaea needs Node 24.3 or later and pnpm. Tests and the scripts run the TypeScript
sources. The CLI and the example run the build.

```sh
pnpm install
pnpm check                                    # format, lint, type check, tests, generated files current
pnpm --filter @hephaestus-build/ichnaea build # dist/, for the CLI and the example
node scripts/build-consumer.ts                # the package, built twice, installed and run as the README says
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Code is [MIT](LICENSE). This includes the zod sources, the generated JSON Schemas and the fixtures.
Specification text and documentation are [CC BY 4.0](LICENSE-docs.md).
