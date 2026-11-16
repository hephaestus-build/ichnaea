# 0021. Releases are attested GitHub release assets

Status: Accepted
Date: 2026-11-16

## Context

Decision 0019 ships one built package on a `build` branch. A deploy key in a main-only
environment writes the branch, and consumers pin a build commit and rebuild it to check it.
Decision 0013 put a pre-release behind a `release` environment with a required reviewer and a
deploy key that alone could create a `v*` tag. Releases were then paused, and the build branch
took their place.

The build branch existed only to avoid that per-release approval gate, and the gate was our own
machinery. GitHub can already show where a tarball came from: an artifact attestation names the
workflow, the ref and the commit that built it, and an immutable release cannot change its tag
or its files. A consumer that verifies the attestation does not need to trust the person who
started the release, the branch that holds the files, or a key.

## Decision

1. **A release is a GitHub release `v0.<minor>.<patch>`.** It has three files: the package's
   tarball `hephaestus-build-ichnaea-<version>.tgz`, its SBOM `sbom.cdx.json`, and `SHA256SUMS`.
   It is a regular release, not a pre-release, while the version is 0.x. Nothing is published to
   npm.
2. **A maintainer starts it by hand** (`workflow_dispatch` of `.github/workflows/release.yml`) on
   `main`, with the tag. No pushed tag starts a release. The tag must be new and greater than
   every `v*` tag. The workflow reads the tags with `git tag`.
3. **The version comes from the tag.** `main` keeps version `0.0.0`. The build job stamps the
   tag's version into the shipped `package.json` (`scripts/build-package.ts --version`), so a
   release needs no commit that changes the version.
4. **The build job has read access only.** It checks that the commit is on `main` and checks the
   tag. It runs `pnpm run check` and assembles the build tree. It runs publint, attw and the
   consumer test on exactly that tree. It packs the tree once with `pnpm pack`, and writes the
   SBOM of what the tarball installs, the checksums and the notes. The notes list the
   conventional commit titles since the previous `v*` tag.
5. **The release job has no environment, no deploy key and no checkout.** Its permissions are
   `contents: write`, `id-token: write` and `attestations: write`. It checks the files against
   `SHA256SUMS` and attests the tarball's build provenance and its SBOM. Then it creates the tag
   at the released commit and publishes the release with the workflow token
   (`gh release create --target`). It refuses a tag that exists already and checks that the new
   tag names the released commit.
6. **The verify job checks the published release as a consumer does.** It downloads the tarball
   from `https://github.com/hephaestus-build/ichnaea/releases/download/<tag>/hephaestus-build-ichnaea-<version>.tgz`,
   runs `gh attestation verify` with `--signer-workflow` and `--source-ref refs/heads/main`,
   installs the tarball with zod into a new project and runs `ichnaea --version`.
7. **Consumers pin the asset URL**, and pnpm records the tarball's integrity hash in their
   lockfile. Before they pin a release or move to a new one, consumers MUST run
   `gh attestation verify <tarball> --repo hephaestus-build/ichnaea --signer-workflow
   hephaestus-build/ichnaea/.github/workflows/release.yml --source-ref refs/heads/main`. The
   release notes give the commands.
8. **Two repository settings protect the release.** Immutable releases are on, so a published
   release's tag and files cannot change. A `v*` tag ruleset blocks the update and the deletion
   of a release tag for everyone. A second `v*` tag ruleset restricts their creation to the
   Maintain and Admin roles and to the GitHub Actions app. `MAINTAINERS.md` § Repository settings
   has the rulesets and how to apply them.
9. **At 1.0, the same pack step also publishes to npm**, with trusted publishing and provenance.
   A new record decides it.
10. **No Changesets.** The conventional commit titles on signed `main` are the change log.

This record supersedes decision 0019 and the environment and deploy key part of decision 0013
(its items 5 and 6). The build branch stays until the consumers move to release assets.

## Evidence

- `gh attestation verify --signer-workflow` enforces only the workflow that signed the
  attestation. `--source-ref` also enforces the git ref
  ([gh attestation verify](https://cli.github.com/manual/gh_attestation_verify)). Without
  `--source-ref`, a copy of `release.yml` that someone with write access changes on a branch and
  runs there signs an attestation that passes.
- A ruleset bypass can name the Maintain and Admin repository roles, teams, GitHub Apps and deploy
  keys ([Creating rulesets for a repository](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository#granting-bypass-permissions-for-your-branch-or-tag-ruleset)).
  The REST API names a GitHub App as an `Integration` actor by its app ID
  ([REST API: repository rules](https://docs.github.com/en/rest/repos/rules)). The workflow token
  is an installation token of the GitHub App that GitHub Actions installs on the repository
  ([GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)). The docs
  do not name that app as a bypass actor in so many words.
- An immutable release locks its tag and its files once it is published
  ([Immutable releases](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/immutable-releases)).
  `gh release create` with files creates a draft, uploads the files and then publishes, so the
  release is complete before it is immutable (`gh release create --help`, gh 2.102.0).
- On this repository, a tree assembled with `--version 0.1.0` passes publint, attw and the
  consumer test. Its tarball installs with zod, and `ichnaea --version` prints `0.1.0`. The
  release SBOM check passes on that tarball for `v0.1.0`.
- `scripts/release-workflow.test.ts` fails a workflow with an environment, a deploy key, a secret,
  a `--prerelease`, another permission, a build without `--version`, or a verify job without
  `--signer-workflow` and `--source-ref refs/heads/main`. `scripts/check-release-tag.test.ts`
  fails a tag that exists, that is not greater than every `v*` tag, or that is not v0.x.y.

## Consequences

- A fix is a patch release: merge it into `main` and run the workflow with the next tag. No
  version commit and no approval of an environment.
- A later pull request removes the build branch machinery (`build-branch.yml`,
  `scripts/verify-build.ts`, the `build-branch` environment, its deploy key and the `build`
  rulesets) once the consumers install release assets.
- A tag that someone makes by hand is harmless. No workflow starts on it, and a release made on it
  has no attestation by the release workflow. A file that someone uploads by hand to a release
  fails `--signer-workflow`. Because a hand-made `v*` tag cannot be moved or deleted, it can block
  the next release: the tag check refuses a tag that is not greater than it, or that is not a
  version. The creation ruleset keeps such tags to maintainers and to workflows. Its bypass for
  the GitHub Actions app covers every workflow on every branch, so a changed workflow on a branch
  can create a tag too. That tag, and any release on it, fails `--source-ref refs/heads/main`.
- A consumer that skips `gh attestation verify`, or runs it without `--signer-workflow` and
  `--source-ref`, has only the integrity hash in its lockfile. That hash shows that the bytes did
  not change since the pin, not who built them.
- The repository must be public: attestations in a private repository need GitHub Enterprise
  Cloud.
