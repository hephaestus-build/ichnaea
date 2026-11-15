# Ichnaea

Ichnaea evaluates GenAI features whenever their configuration changes: code, prompts, the model,
its parameters or the application's settings. It gives each change a clear verdict from paired
statistics, and says plainly when the cases cannot decide.

> **Status: early development.** Before 1.0, releases are pre-releases: tarballs on
> [GitHub releases](https://github.com/hephaestus-build/ichnaea/releases), not npm packages.
> Interfaces can change in any pre-release.

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

| Package                               | Content                                                                                                                                 | State           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `@hephaestus-build/ichnaea-contracts` | zod schemas, the normative JSON Schema 2020-12 files, shared fixtures, RFC 8785 canonical hashing, configuration identity, data classes | in pre-releases |
| `@hephaestus-build/ichnaea-stats`     | Intervals, paired and stratified tests, power. The regression test is validated; non-inferiority is not, until the margin floor is set  | in pre-releases |
| `@hephaestus-build/ichnaea-core`      | Plugin host, lifecycle, planner, import mode, file store, call ledger, CLI                                                              | in pre-releases |
| `@hephaestus-build/ichnaea-decide`    | Decision rule with its power statement, and the `decide` command                                                                        | in pre-releases |
| `@hephaestus-build/ichnaea-report`    | Markdown and HTML reports with an interval lint, and the `report` command                                                               | in pre-releases |
| `@hephaestus-build/ichnaea-runner`    | Runner                                                                                                                                  | planned         |
| `@hephaestus-build/ichnaea-testkit`   | Conformance kits                                                                                                                        | planned         |

All packages have the same version. They need Node 22.18.0 or later: the CLI loads
`ichnaea.config.ts` with the type stripping of Node, which needs no flag from 22.18.0. zod 4 (4.6
or later) is a peer dependency.

## Install

Before 1.0, each release `v0.<minor>.<patch>` is a
[GitHub pre-release](https://github.com/hephaestus-build/ichnaea/releases) with:

- one tarball per package, `hephaestus-build-ichnaea-<package>-<version>.tgz`;
- `SHA256SUMS`, the SHA-256 checksums of the tarballs;
- `sbom.cdx.json`, a CycloneDX SBOM that lists the packages of the release, their dependencies,
  and zod at the version the release was tested with.

The release workflow builds every pre-release from a commit on `main`, and creates its tag. Each
tarball has a build provenance attestation and an SBOM attestation, signed with the identity of that
workflow. Nothing is published to npm yet.

The commands here install v0.1.0. For another release, replace the version. The notes of each
release give its snippet. With pnpm, first map every Ichnaea package to its tarball in
`pnpm-workspace.yaml`, so that the dependencies between them resolve without a registry:

<!-- The tarball smoke test writes this file, with each release URL changed to its tarball. -->

```yaml
overrides:
  "@hephaestus-build/ichnaea-contracts": "https://github.com/hephaestus-build/ichnaea/releases/download/v0.1.0/hephaestus-build-ichnaea-contracts-0.1.0.tgz"
  "@hephaestus-build/ichnaea-core": "https://github.com/hephaestus-build/ichnaea/releases/download/v0.1.0/hephaestus-build-ichnaea-core-0.1.0.tgz"
  "@hephaestus-build/ichnaea-decide": "https://github.com/hephaestus-build/ichnaea/releases/download/v0.1.0/hephaestus-build-ichnaea-decide-0.1.0.tgz"
  "@hephaestus-build/ichnaea-report": "https://github.com/hephaestus-build/ichnaea/releases/download/v0.1.0/hephaestus-build-ichnaea-report-0.1.0.tgz"
  "@hephaestus-build/ichnaea-stats": "https://github.com/hephaestus-build/ichnaea/releases/download/v0.1.0/hephaestus-build-ichnaea-stats-0.1.0.tgz"
```

Then add the packages that you import, by the same URLs, and zod. The five-minute example below
imports contracts, core, decide and report. The CLI loads `ichnaea.config.ts` as an ES module:

<!-- The tarball smoke test runs this block, with each release URL changed to its tarball. -->

```sh
pnpm pkg set type=module
pnpm add zod@4.6.7 \
  https://github.com/hephaestus-build/ichnaea/releases/download/v0.1.0/hephaestus-build-ichnaea-contracts-0.1.0.tgz \
  https://github.com/hephaestus-build/ichnaea/releases/download/v0.1.0/hephaestus-build-ichnaea-core-0.1.0.tgz \
  https://github.com/hephaestus-build/ichnaea/releases/download/v0.1.0/hephaestus-build-ichnaea-decide-0.1.0.tgz \
  https://github.com/hephaestus-build/ichnaea/releases/download/v0.1.0/hephaestus-build-ichnaea-report-0.1.0.tgz
```

The lockfile then pins the integrity hash of each tarball.

### Verify

Verify each tarball before you use it. You need the [GitHub CLI](https://cli.github.com/).
Download the release with `gh release download v0.1.0 --repo hephaestus-build/ichnaea`, then:

```sh
# Build provenance: built by the release workflow from a commit on main, on a GitHub-hosted runner
gh attestation verify <tarball> --repo hephaestus-build/ichnaea \
  --signer-workflow hephaestus-build/ichnaea/.github/workflows/release.yml \
  --source-ref refs/heads/main --deny-self-hosted-runners
# The SBOM (CycloneDX) attested for the same tarball
gh attestation verify <tarball> --repo hephaestus-build/ichnaea \
  --signer-workflow hephaestus-build/ichnaea/.github/workflows/release.yml \
  --source-ref refs/heads/main --deny-self-hosted-runners \
  --predicate-type https://cyclonedx.org/bom
# Checksums of the tarballs you downloaded
sha256sum --check --ignore-missing SHA256SUMS
```

`--repo` alone is not enough: it accepts an attestation from any workflow on any branch of the
repository. `--signer-workflow` and `--source-ref` accept only the release workflow on `main`.

## Five-minute example

[`examples/support-assistant`](examples/support-assistant/README.md) is a synthetic support
assistant. Another runner wrote its results. Ichnaea imports them, decides and reports, with no
model call. In the project where you installed the packages, copy the example from the tag of your
release. Then import, decide and report two candidates against the same base. Each candidate is a
new model with a new prompt: the trigger is `new-model`, and `--vary prompt.answer` declares the
prompt change.

<!-- The tarball smoke test runs this block on the packed tarballs. -->

```sh
git clone --depth 1 --branch v0.1.0 https://github.com/hephaestus-build/ichnaea.git
example=ichnaea/examples/support-assistant
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

<!-- The tarball smoke test checks these verdict lines and exit codes. -->

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

The packages and the CLI need Node 22.18 or later: the CLI loads `ichnaea.config.ts`, and Node runs
TypeScript files without a flag from 22.18. Developing Ichnaea needs the same version and pnpm.

```sh
pnpm install
pnpm check      # format, lint, type check, tests, generated files current
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Code is [MIT](LICENSE). This includes the zod sources, the generated JSON Schemas and the fixtures.
Specification text and documentation are [CC BY 4.0](LICENSE-docs.md).
