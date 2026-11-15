# 0013. Pre-releases are attested tarballs on GitHub releases

Status: Accepted
Date: 2026-11-15

## Context

Applications want to use Ichnaea before 1.0. The interfaces still change, so we do not want to
publish to npm yet. A version on npm stays there, and npm names are hard to take back.

A consumer must still be able to install a pre-release without a registry. The consumer must also
be able to check two facts: the tarball was built from reviewed code on `main`, and the tarball
lists what it installs.

Any person with write access can push a tag. If a pushed tag starts a release, a writer can
release code that nobody reviewed. The attestation of that release then verifies with
`gh attestation verify --repo`, because that check accepts any workflow on any ref of the
repository.

## Decision

1. A pre-release is a GitHub release `v0.<minor>.<patch>`. It holds one tarball per package,
   `SHA256SUMS` and `sbom.cdx.json`. All packages have the same version. Nothing is published to
   npm.
2. A maintainer starts a release by hand (`workflow_dispatch`) on `main` with the tag. No pushed
   tag starts a release. The workflow fails unless it runs on `main` and the commit is reachable
   from `main`.
3. The build job has read access only. It runs the checks, packs each package once, runs the
   example on the tarballs, and writes the SBOM, the checksums and the notes.
4. The SBOM comes from what is shipped. The tarballs are installed into an empty project, as a
   consumer would install them, and `pnpm sbom` lists that project's production dependencies. The
   release fails if the SBOM lists no components, misses a shipped package at its version and
   SHA-512, or misses a dependency of a shipped package.
5. The release job runs in the `release` environment. Only `main` may deploy to it, and a
   maintainer approves each run. It attests build provenance and the SBOM for each tarball,
   creates the tag on the released commit, and publishes the release.
6. The job creates the tag with a deploy key. The key is a secret of the `release` environment. A
   tag ruleset lets only deploy keys create a `v*` tag, and a second ruleset lets nobody move or
   delete one. The release key is the only deploy key of the repository. Releases are immutable.
7. Consumers verify with `--signer-workflow` and `--source-ref refs/heads/main`, not with `--repo`
   alone. The README shows the commands.

## Evidence

- A ruleset bypass names an actor: a role, a team, an app, a user or the deploy keys. It cannot
  name a workflow file or a ref
  ([REST API: create a repository ruleset](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset)).
  Every workflow's `GITHUB_TOKEN` belongs to the same GitHub Actions app
  ([GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)), so a bypass
  for that app would let a workflow on any branch create a tag.
- A job can read an environment's secrets only if it references the environment and its ref
  passes the environment's branch policy. With required reviewers, the job waits for approval
  before it gets the secrets
  ([Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)).
  So only an approved job on `main` can hold the deploy key.
- `gh attestation verify --repo` checks only the repository. `--signer-workflow` and
  `--source-ref` also check the workflow and the ref
  ([gh attestation verify](https://cli.github.com/manual/gh_attestation_verify)).
- syft 1.57.1, the tool that `anchore/sbom-action` runs, lists 0 components for a directory of the
  packed tarballs. `pnpm sbom` on the project that installs them lists 6: the 5 packages and zod.
- `scripts/check-on-main.test.ts` fails a commit that is off `main`, a commit that does not exist,
  and a run on another ref. `scripts/check-sbom.test.ts` fails an empty SBOM, a missing package, a
  package with another SHA-512, and a missing dependency.

## Consequences

- A consumer installs from release URLs with pnpm overrides, not from npm. The lockfile pins each
  tarball's integrity hash.
- A release needs a maintainer twice: to merge the version change into `main`, and to approve the
  `release` environment.
- The setup needs repository settings that the code cannot enforce: the environment, the deploy
  key, the two tag rulesets and immutable releases. `MAINTAINERS.md` lists them with the commands
  that apply them.
- The repository must be public before the first release. Attestations in a private repository
  need GitHub Enterprise Cloud.
- When we publish to npm, a new record supersedes this one.
