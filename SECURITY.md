# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/hephaestus-build/ichnaea/security/advisories/new).
Do not open a public issue. If the form is not available, ask a maintainer in
[MAINTAINERS.md](MAINTAINERS.md) on GitHub for a private channel, and give no details in public.
We aim to acknowledge a report within five working days.

A weakness in the release process is in scope too: the release workflow, the attestations, the
SBOM or the checksums.

## Supported versions

Before 1.0, releases are pre-releases `v0.<minor>.<patch>`: tarballs on
[GitHub releases](https://github.com/hephaestus-build/ichnaea/releases), not npm packages. All
packages have the same version. Only the latest pre-release receives security fixes. A fix ships
as a new pre-release. We do not patch older pre-releases.

Verify each tarball with `gh attestation verify` before you use it, as the
[README](README.md#verify) shows.

## Scope and trust model

Ichnaea is a library and a CLI. It runs plugins and configuration files as trusted code and does
not sandbox them. It listens on no network port. Every record field carries a data class, and the
egress projection drops unknown and unclassified fields; secret redaction at capture time arrives
with the runner and is not built yet.

## Automated checks

Three workflows check the supply chain in addition to CI:

- **CodeQL** (`codeql.yml`) analyses the TypeScript and JavaScript sources and the workflows on each
  pull request, on each push to `main` and weekly. It uses the default query suite.
- **Dependency review** (`dependency-review.yml`) fails a pull request that adds or changes a
  dependency with a known high or critical vulnerability, or with a licence outside the allowlist in
  the workflow.
- **OpenSSF Scorecard** (`scorecard.yml`) scores the repository's practices on each push to `main`,
  weekly and when branch protection changes, and publishes the result.

Their results go to code scanning, in the repository's Security tab. These features need a public
repository, so while the repository is private each workflow skips its check and says so in a
notice.
