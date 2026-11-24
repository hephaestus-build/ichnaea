# 0022. Stage release candidates under next

Status: Accepted
Date: 2026-11-24

## Context

Ichnaea needs an npm release candidate for consumers to test. The first stable release waits for
a separate decision. In the meantime, a later README example can differ from the one that ran
against a tagged build.

## Decision

1. The first release candidate is `@tumaet/ichnaea@0.1.0-rc.1`. The stage job accepts only a
   pushed 0.x pre-release tag and passes `--tag next`. A stable 0.x tag cannot stage. It still
   counts in tag order, so it can block a lower candidate.
2. A breaking change since the previous 0.x version tag requires a minor bump. The previous
   version tag can itself be a pre-release.
3. The finish workflow runs the verifier from the default branch. It installs the version
   from npm and uses the README and example from the staged run's artifact.
4. The rest of [decision 0021](0021-npm-staged-publishing.md) applies. The workflow stages a
   tarball with OIDC and provenance. A package owner approves it with two-factor authentication.
   The finish workflow verifies the registry tarball before it creates the GitHub release.

## Evidence

- The tag check accepts a 0.x candidate and rejects stable and malformed tags. A Git fixture
  checks that a breaking change after an earlier candidate requires a new minor.
- CI replays a saved example after replacing the checkout's README and example configuration.
- npm [accepts a dist-tag for staged publishing](https://docs.npmjs.com/cli/commands/npm-stage/#tag).

## Consequences

Consumers install the candidate by exact version or with `@tumaet/ichnaea@next`, then check its
signatures. A maintainer follows the bootstrap and approval steps in
[MAINTAINERS.md](../../MAINTAINERS.md#releases).
