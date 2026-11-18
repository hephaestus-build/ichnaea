# 0019. One built package on a build branch

Status: Superseded by 0021
Date: 2026-11-16

## Context

Decision 0018 made consumers pin this repository as a git submodule and run its TypeScript sources
with Node's type stripping. Each consumer had to be a pnpm workspace, list five packages, and run
sources that its own compiler profile type-checked as its own code. Node does not strip types under
`node_modules`, so nothing could be installed as a normal dependency.

The consumers want one dependency that they install like any other, pinned to a reviewed commit,
with JavaScript and declarations, and with no registry before 1.0. Integrity must be checkable
without trusting the machine that built it.

## Decision

1. **One package.** `@hephaestus-build/ichnaea` in `packages/ichnaea` replaces the five packages.
   Its subpaths are `.` (the core with its CLI, the decision rule and the reports), `./contracts`,
   `./stats`, `./schemas/*.json` (the JSON Schema files, for callers in other languages) and
   `./package.json`. Lint rules keep the areas apart: `src/stats` imports nothing outside itself,
   `src/contracts` nothing but zod, and core, decide and report only the areas below them. zod
   stays a peer dependency. The public API keeps its names; only where they are imported from
   changes.
2. **Built with `tsc`.** The package ships ESM JavaScript, declarations, declaration maps and source
   maps in `dist/`, and its sources in `src/`. Inside the repository a custom condition,
   `ichnaea-source`, resolves the package to its sources, so tests and type checks need no build.
3. **The `build` branch.** On every push to `main`, `.github/workflows/build-branch.yml` builds the
   commit, assembles the build tree (`scripts/build-package.ts`) and appends one commit to `build`
   whose tree is exactly that tree. Its message is `build: <main title>` with a
   `Source-Commit: <main commit>` trailer. The first build commit has no parent, so the history of
   `main` never enters `build`. Consumers pin `github:hephaestus-build/ichnaea#<build-commit>`.
4. **The writer.** Only a deploy key writes `build`. Its private key is a secret of the
   `build-branch` environment, which only `main` can deploy to, and only the publish job of the
   build workflow names that environment. A repository secret would reach the workflows of any
   branch, so the key is not one. The ruleset on `build` lets deploy keys alone bypass it, and a
   second ruleset with no bypass blocks force pushes and deletion. The deploy key is the
   repository's only write deploy key, because a deploy key bypass covers every one. Build commits
   are not signed: the integrity comes from item 5.
5. **Reproducibility is the integrity.** The chain is a reviewed, signed commit on `main`, a
   deterministic build of it that anyone can reproduce, and the build commit that the deploy key
   writes. The build pins one Node version (24.22.2) and the lockfile. The tree is byte for byte
   the same on every rebuild: the manifest has sorted keys, source maps name sources by relative
   paths, and nothing records a time, a path or a machine. `build.json` records the Node and pnpm
   versions, the source commit and the tree digest. `scripts/verify-build.ts` rebuilds a build
   commit from its `Source-Commit` and refuses any difference, naming the first differing path. It
   also refuses a `Source-Commit` that is not on `main` or not signed, another Node or pnpm version,
   and a build commit without its SBOM. The build workflow runs it on each new build commit, and a
   consumer runs it before moving a pin.
6. **The shipped manifest runs nothing.** The build tree's `package.json` has no scripts of any
   kind, no development or runtime dependencies and no `workspace:` range. Installing it runs no
   script, which matters most for a git dependency, whose `prepare` script a package manager runs.
7. **An SBOM in every build commit.** `sbom.cdx.json` is a CycloneDX SBOM of what the package
   ships and its peer dependency at the tested version. Its timestamp is the source commit's
   committer date, and its serial number is a UUID version 5 of the source commit, so two builds of
   one commit give the same SBOM.
8. **One Node floor.** The package, the repository and the example need Node 24.3 or later. CI
   tests on 24.3.0 and on the current 24.
9. **No Changesets.** The conventional commit titles on signed `main` are the change log.
10. **At 1.0.** The same build tree is packed and published to npm with OIDC trusted publishing
    and provenance. The release design of decision 0013 stays in the repository for that, paused,
    and is not revived now. A release key returns only with a protection of `build` that does not
    rely on "deploy keys only".

This record supersedes decision 0018. It implements:

- **REQ-26:** the CLI runs on the CI host from a pinned build commit,
  `github:hephaestus-build/ichnaea#<build-commit>`.
- **REQ-110:** one ESM package with subpath exports, built with `tsc` to JavaScript with
  declarations, declaration maps and source maps, for Node 24.3 or later. CI builds every `main`
  commit, tests the built output and commits it to `build`. The API reports, one per subpath, are
  committed. The build's `package.json` has no lifecycle scripts.
- **REQ-113:** `build` is written only by the deploy key in the main-only `build-branch`
  environment. The ruleset lets deploy keys alone bypass, and blocks force pushes. Every build
  commit names a signed `main` Source-Commit and is reproducible from it. Both the pin step and a
  CI job on each build commit rebuild it, and refuse any difference by naming the first differing
  file. Actions stay pinned by SHA with read-only permissions, and the pnpm dependency policy
  applies.

## Evidence

- `scripts/build-consumer.ts`, on Node 24.3.0 and 24 in CI, builds the working tree twice, in two
  checkouts at two paths, and requires byte-identical trees. It packs exactly that tree, installs it
  into a new project with zod outside the repository, and fails unless no script runs, one zod is
  installed, every subpath loads, the declarations type-check under three consumer profiles with
  `skipLibCheck` off, and the README's example gives its verdict lines and exit codes with the CLI
  and with the library API.
- `scripts/build-package.test.ts` tests the manifest: no scripts, no dependencies but the zod peer,
  exactly the decided subpaths with their types first, and every export and bin target present in
  an assembled tree, with the bin executable. It also checks that no file of the tree names a path
  on the build machine and that every source map names its sources relatively.
- `scripts/check-sbom.test.ts` tests the SBOM: its serial number and timestamp come from the source
  commit, its lists are sorted, it names the source commit and lists the peer dependency, and it
  holds no path on the build machine. The assembled tree's SBOM passes the same check.
- `scripts/build-branch.test.ts` tests the workflow and the rulesets: only the publish job holds the
  key, in an ssh-agent; the pinned SSH host keys have GitHub's published fingerprints; the push
  never forces; only `build-branch.yml` names the environment; and the rulesets have the shape
  above.
- `scripts/verify-build.ts` refuses a build commit with one changed byte, one changed mode or one
  extra file, and names the first differing path in path order.

## Consequences

- A consumer adds one dependency and zod. It needs Node 24.3 or later, and neither a workspace nor
  a registry.
- A pin moves in a pull request in the consumer's repository, after `verify-build.ts` passes for the
  new build commit.
- Every change to the build's inputs (the build script, tsc, the lockfile, the pinned Node) must
  keep the build deterministic, or the verify job fails. Verification needs the Node version that
  the build commit records.
- Not every `main` commit gets a build commit: a newer push replaces a waiting run. The
  `Source-Commit` trailer always names the source, and `build` never moves back.
- Local co-development links the package of a checkout and runs `build --watch`; nothing of that
  is committed.
