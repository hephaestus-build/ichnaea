# 0018. Distribution by pinned source commit; releases paused

Status: Accepted
Date: 2026-11-16

## Context

Decision 0013 made pre-releases attested tarballs on GitHub releases. Three consumers now use
Ichnaea from their own repositories. Each needs to run Ichnaea from a reviewed commit that it
controls, update that commit on purpose, and never depend on a registry or a build step.

Node 24.2 and later run TypeScript sources with type stripping. They refuse to strip types for a
file under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so packed tarballs of
TypeScript sources cannot run once installed. A workspace package that a symbolic link points to
resolves to its real path, outside `node_modules`, so Node runs it.

## Decision

1. The packages ship their TypeScript sources. Each package's main export and core's `ichnaea` bin
   name `src/*.ts`. There is no build step and no `dist/`. Every package and the repository need
   Node 24.2 or later, the one floor for consumers and developers alike.
2. A consumer pins Ichnaea as a git submodule at `vendor/ichnaea`, at the root of its TypeScript
   workspace. It lists `vendor/ichnaea/packages/*` in its pnpm workspace, and installs zod 4.6 or
   later once at its root, because the library packages take zod as a peer dependency.
3. The pin is the submodule's commit. Any signed commit on `main` may be pinned. A pin moves in a
   pull request in the consumer's repository, which a maintainer reviews.
4. Integrity comes from the pinned commit: every branch of this repository requires signed
   commits, and the commit is on `main`. Consumers check both before they move a pin.
5. Releases are paused. `release.yml` fails in its first step and says why. Nothing is published
   to npm or to GitHub releases.
6. From decision 0013, these stay as the design for a later release, not as current practice: the
   manual dispatch on `main`, the read-only build job, the SBOM built from what is installed, the
   approved `release` environment, the tag created by a deploy key, the tag rulesets and immutable
   releases. They are not removed, so that a release can resume from a reviewed design.

This record supersedes decision 0013.

## Evidence

- On Node 24.22, a fresh clone with `pnpm install --frozen-lockfile` and no build runs
  `node packages/core/src/bin.ts --version`, and its tree stays clean.
- `scripts/submodule-consumer.ts` adds a commit of this repository as a real git submodule of a new
  pnpm workspace. It runs the README's install, checks that the submodule stays clean, type-checks
  every package's public API through the workspace link under three compiler profiles, and runs the
  five-minute example with Node against the README's verdict table. It fails when an export points
  at a missing file, when the bin loses its executable bit, and when a source file breaks a strict
  profile.
- The consumer installs one copy of zod, because every library package names it as a peer.
- CI runs the tests at the floor, Node 24.2.0, and at the current Node 24.

## Consequences

- A consumer needs Node 24.2 or later and a pnpm workspace. It does not need a build, a registry or
  a release.
- A consumer's lockfile pins zod, and the submodule commit pins Ichnaea. Updating Ichnaea is a
  reviewed change in the consumer's repository.
- Records name the package version today. A change to the record contracts adds the Ichnaea commit,
  so a result can be traced to the source that produced it.
- The release workflow, the SBOM check and the release settings stay in the repository, unused.
  When releases resume, a new record supersedes this one.
