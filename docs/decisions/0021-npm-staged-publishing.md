# 0021. Releases are staged on npm, and an owner approves each version

Status: Accepted
Date: 2026-11-16

## Context

Decision 0019 ships one built package on a `build` branch. Consumers pin a build commit and rebuild
it to check it, and npm was to come at 1.0. Decision 0013 put pre-releases as tarballs on GitHub
releases, behind an environment with a deploy key, and was paused.

Consumers want a normal dependency now: a name on a registry, versions, and a check that does not
need a rebuild. A registry version cannot be taken back, so no workflow, token or person with write
access to the repository may publish one alone.

npm's staged publishing splits the publish in two. `npm stage publish` puts a version on the
registry where nobody can install it. A package owner then approves it on npmjs.com with
two-factor authentication, or rejects it. A trusted publisher (OIDC) can be limited to staging.

## Decision

1. **The package is `@tumaet/ichnaea` on npm.** It is the one package of decision 0019, with its
   subpaths, built with `tsc`. The shipped `package.json` runs nothing on install, has no
   dependency but the zod peer, and has `publishConfig.access: public`. The development
   `package.json` is `private: true`, so that nothing publishes it by mistake. The package needs
   Node 24.3 or later.
2. **Every version is staged, and a package owner approves it.** No workflow publishes directly.
   This applies to pre-releases too. A rejected version publishes nothing.
3. **A pushed `v<x.y.z>` tag starts `.github/workflows/release.yml`.** Only the release team, the
   `maintainer` team today, may create a `v*` tag, and nobody may move or delete one. The tag is
   `v0.<minor>.<patch>`, with an optional pre-release, and greater than every other `v*` tag in
   semver order. In 0.x, a breaking change since the last tag (`type!:` or a `BREAKING CHANGE:`
   footer) needs a minor version above the last release. The tagged commit must be on `main`.
4. **The version comes from the tag.** `main` keeps `0.0.0`. The pack job stamps the tag's version
   into the shipped `package.json` (`scripts/build-package.ts --version`).
5. **`release.yml` checks, packs once and stages.** The check job runs the tag checks and
   `pnpm run check`. The pack job runs publint and attw on the build tree, packs it once, and
   records the tarball's SHA-512 in npm's `sha512-…` form, the SBOM, `SHA256SUMS` and the notes.
   The consumer job installs exactly that tarball as the README says and runs its example, on
   Node 24.3.0 and 26. The stage job runs in the `npm` environment, which only `v*` tags may deploy
   to. It has only `id-token: write`, no checkout, and runs no repository code. It checks the
   SHA-512 and then runs `npm stage publish <tarball> --provenance --access public
   --tag <latest|next> --ignore-scripts`, with npm 11.15.0 or later. A pre-release gets `next`.
6. **The trusted publisher may only stage.** It names `hephaestus-build/ichnaea`,
   `release.yml` and the `npm` environment, with `--allow-stage-publish` and never
   `--allow-publish`. The package requires two-factor authentication and disallows tokens. So the
   repository holds no npm token, and no token or workflow can publish a version without an owner.
7. **`.github/workflows/release-finish.yml` finishes a release after the approval.** It runs by
   dispatch with a tag, or daily for every `v*` tag whose version npm lists and that has no
   GitHub release. It reads the staged files from the artifact of the tag's release run. It fails
   unless the registry's integrity equals the staged SHA-512. It fails unless `npm audit
   signatures` in a new project finds valid signatures and a provenance whose subject is that
   tarball, built by `release.yml` at the tag on a GitHub-hosted runner. It fails unless the bin
   prints the version and the README's install and example run. Then a job with no repository
   code creates the GitHub release on the tag: the notes, the tarball, `sbom.cdx.json` and
   `SHA256SUMS`.
8. **Consumers check with `npm audit signatures`.** The README's install is
   `pnpm add @tumaet/ichnaea zod@<tested>` followed by `npm audit signatures`.
9. **Versioning is 0.x semver.** The GitHub release notes, from the conventional commit titles
   since the previous version tag, are the one change log. There are no Changesets.
10. **The build branch stays until its consumers move.** `build-branch.yml`, `verify-build.ts`, the
    `build-branch` environment and the `build` rulesets keep working as decision 0019 describes.
    A later change removes them.

This record supersedes decision 0013 and decision 0019. It implements REQ-26 and REQ-110 with the
npm package in place of the build commit, and REQ-113 for the release: only reviewed, signed
`main` commits reach a version, through a tag that only the release team creates.

## Evidence

- npm 11.19.1 documents `npm stage publish`, `npm stage approve` with two-factor authentication,
  and trust relationships with `--allow-stage-publish` and `--allow-publish`, and needs 11.15.0
  for `npm trust` (`npm help stage`, `npm help trust`). `npm stage publish` refuses a `private`
  package, as `npm publish` does.
- On this repository, a tree assembled with `--version 0.1.0-rc.1` passes publint and attw. Its
  tarball passes the consumer test and the release SBOM check. `npm stage publish <tarball>
  --access public --tag next --ignore-scripts --dry-run` reports the same `sha512-…` integrity as
  the pack job's `openssl dgst -sha512 -binary | base64`.
- `npm audit signatures --json --include-attestations` lists each verified package with its
  attestation bundles. The SLSA v1 statement names the tarball's SHA-512 and
  `buildDefinition.externalParameters.workflow` with the repository, the workflow path and the ref.
- `scripts/release-workflow.test.ts` fails a release workflow that another event starts, that
  holds a secret, a token or a registry URL, or that publishes directly. It also fails one whose
  stage job has a checkout or a permission other than `id-token: write`, or that stages before it
  checks the SHA-512. `scripts/check-release-tag.test.ts`, `scripts/verify-published.test.ts` and
  `scripts/release-pending.test.ts` test the tag rules, the provenance check and the choice of
  pending tags.

## Consequences

- A release is two acts: a maintainer pushes the tag, and a package owner approves the version on
  npmjs.com. The GitHub release follows within a day, or at once by dispatch.
- The staged files live in the release run's artifact for 90 days. A version approved later cannot
  be finished: release the next version instead.
- `release.yml` runs as the tagged commit defines it. A member of the release team could tag a
  commit off `main` with a changed workflow. The main check would not stop that workflow, but
  the owner sees the commit in the provenance before approving.
- The first version needs a bootstrap by a scope owner, because a trusted publisher needs an
  existing package: publish `0.0.0-bootstrap` by hand with two-factor authentication, configure the
  stage-only trusted publisher, require two-factor authentication and disallow tokens, and
  deprecate the bootstrap version. `MAINTAINERS.md` has the steps.
- A consumer that skips `npm audit signatures` has only the integrity hash in its lockfile. That
  hash shows that the bytes did not change since the install, not who built them.
