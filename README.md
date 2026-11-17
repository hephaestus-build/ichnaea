# Ichnaea

[![CI status on main](https://github.com/hephaestus-build/ichnaea/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hephaestus-build/ichnaea/actions/workflows/ci.yml?query=branch%3Amain)
[![OpenSSF Scorecard](https://img.shields.io/ossf-scorecard/github.com/hephaestus-build/ichnaea?label=OpenSSF%20Scorecard&style=flat)](https://scorecard.dev/viewer/?uri=github.com/hephaestus-build/ichnaea)
[![MIT licence](https://img.shields.io/github/license/hephaestus-build/ichnaea?style=flat)](./LICENSE)

Ichnaea evaluates GenAI features whenever their configuration changes: code, prompts, the model,
its parameters or the application's settings. It gives each change a clear verdict from paired
statistics, and says plainly when the cases cannot decide.

> **Status: early development.** There are no releases yet: you pin a commit of the `build` branch.
> Interfaces can change in any commit.

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

Install a commit of the `build` branch. Each commit there holds the built package of one commit
on `main`, and nothing else. Its message names that commit in a `Source-Commit:` trailer. Releases
to npm come at 1.0.

Pick the newest build commit:

```sh
gh api repos/hephaestus-build/ichnaea/commits/build --jq .sha
```

Then, at the root of your project, add zod and Ichnaea at that commit. The CLI loads
`ichnaea.config.ts` as an ES module:

<!-- The build consumer test runs this install. -->

```sh
pnpm pkg set type=module
pnpm add zod@4.6.7 'github:hephaestus-build/ichnaea#<build-commit>'
```

Your `package.json` then has
`"@hephaestus-build/ichnaea": "github:hephaestus-build/ichnaea#<build-commit>"`, and your lockfile
pins it. zod at the root is the one copy that Ichnaea uses. Run the CLI with Node 24.3 or later:
`pnpm exec ichnaea <command>`. Installing the package runs no script: its `package.json` has none.

### Check a build commit

Integrity comes from reproducibility. A build commit names a signed, reviewed commit on `main`,
and anyone can build that commit again and get the same bytes. Before you pin or update, rebuild
the build commit in an Ichnaea checkout:

```sh
git clone https://github.com/hephaestus-build/ichnaea && cd ichnaea
pnpm install --frozen-lockfile
node scripts/verify-build.ts <build-commit>
```

`verify-build.ts` reads the `Source-Commit` trailer and checks that the commit is on `main` and
that GitHub shows its signature as verified. It
builds that commit in a temporary worktree, with the Node and pnpm versions that the build
commit's `build.json` records, and compares the result with the build commit byte for byte: the
same paths, bytes and modes. It refuses on the first difference and names the file. It also checks
the build commit's SBOM, `sbom.cdx.json`, which lists what the package ships and its peer
dependency. Run it with the Node version that `build.json` names (24.22.2 today); it refuses
another.

Only the build workflow writes `build`, with a deploy key that only a main-only environment
holds. [Decision 0019](docs/decisions/0019-built-package-on-a-build-branch.md) gives the chain.

### Update the pin

Run `pnpm add 'github:hephaestus-build/ichnaea#<newer build commit>'` after you checked the newer
commit.

### Develop Ichnaea and your project together

In the Ichnaea checkout, build on every change:

```sh
pnpm --filter @hephaestus-build/ichnaea build --watch
```

In your project, link the package of that checkout instead of the build commit:

```sh
pnpm link <path to the Ichnaea checkout>/packages/ichnaea
```

To undo it, run `pnpm unlink @hephaestus-build/ichnaea` and then `pnpm install`, so that your
lockfile's build commit is installed again. Stop the watch with Ctrl-C. Never commit the link: it
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
node scripts/build-package.ts <directory>     # the tree that the build branch holds for this commit
node scripts/build-consumer.ts                # that tree, built twice, installed and run as the README says
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Code is [MIT](LICENSE). This includes the zod sources, the generated JSON Schemas and the fixtures.
Specification text and documentation are [CC BY 4.0](LICENSE-docs.md).
