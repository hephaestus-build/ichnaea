# Security policy

## Reporting a vulnerability

**Do not report a vulnerability in a public issue, discussion or pull request.**

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/hephaestus-build/ichnaea/security/advisories/new).
It keeps the report confidential and credits you in the advisory that follows. If you cannot use
GitHub, email [security@hephaestus.build](mailto:security@hephaestus.build) with the subject
"Ichnaea Security Vulnerability Report".

Include as much as you can:

- the affected package and release, or the part of the release process;
- the steps to reproduce, ideally with a proof of concept;
- the impact: what an attacker could achieve;
- any fix or mitigation that you suggest.

## What to expect

- We aim to acknowledge a report within five working days.
- We follow **coordinated disclosure**: give us time to ship a fix before you disclose the
  vulnerability in public. If we cannot agree on a date, the default disclosure date is **90 days**
  after your report. It is earlier when the vulnerability is actively exploited.
- We fix a confirmed vulnerability as soon as we can, in a new pre-release, and publish it as a
  [GitHub security advisory](https://github.com/hephaestus-build/ichnaea/security/advisories). We
  credit you unless you prefer to stay anonymous.

We do not run a bug bounty programme.

## Safe harbour

We consider good-faith security research under this policy to be authorised, and we will not
pursue or support legal action against you for it. If a third party takes action against you for
such research, we will make our authorisation known. In return, test on your own machine with your
own data, access only the minimum data needed to show an issue, and do not change this repository,
its tags or its releases to show it.

## Supported versions

Before 1.0, releases are pre-releases `v0.<minor>.<patch>`: tarballs on
[GitHub releases](https://github.com/hephaestus-build/ichnaea/releases), not npm packages. All
packages have the same version. **Only the latest pre-release receives security fixes.** A fix
ships as a new pre-release. We do not patch older pre-releases.

Verify each tarball with `gh attestation verify` before you use it, as the
[README](README.md#verify) shows.

## Scope

Ichnaea is a library and a CLI that run on your machine. In scope:

- the code of the packages in this repository, the CLI included;
- the release process: the release workflow, the attestations, the SBOM and the checksums;
- the GitHub Actions workflows in this repository.

Trust model: Ichnaea runs plugins and configuration files as trusted code and does not sandbox
them. It listens on no network port. Every record field carries a data class, and the egress
projection drops unknown and unclassified fields; secret redaction at capture time arrives with
the runner and is not built yet.

Out of scope:

- what a plugin or a configuration file does: Ichnaea runs it as trusted code, as the trust model
  states;
- the application under evaluation, its model providers and the services that it calls;
- vulnerabilities in third-party dependencies, zod included, without an Ichnaea-specific exploit
  path: report those upstream;
- a tarball that does not come from this repository's GitHub releases, or that fails
  `gh attestation verify`;
- denial of service through input that you control, and scanner output without a demonstrated
  impact;
- social engineering or phishing of maintainers or users.

## Automated security measures

Independent of this reporting channel, the repository has:

- **Dependency updates:** Renovate proposes updates of the npm dependencies, the GitHub Actions,
  the oracle images and the oracle requirements every week, each at least 7 days after its release
  ([`.github/renovate.json`](.github/renovate.json)). A vulnerability fix skips that wait in
  Renovate, but pnpm's own minimum release age still applies to a newly resolved npm version.
  Oracle updates wait for a maintainer's approval on the dependency dashboard.
- **Static analysis and dependency review:** CodeQL checks the TypeScript code and the workflows,
  dependency review blocks a pull request that adds a dependency with a high or critical advisory
  or an unlisted licence, and OpenSSF Scorecard rates the repository. They run once the repository
  is public; while it is private they skip and say so
  ([`.github/workflows/`](.github/workflows)).
- **Install policy:** pnpm installs a version only when it is at least 7 days old, runs no install
  script of a dependency, and refuses a version that was published with less trust evidence than
  an earlier version of the same package ([`pnpm-workspace.yaml`](pnpm-workspace.yaml)).
- **Workflow audit in CI:** actionlint and zizmor check every workflow on each pull request
  ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).
- **Release integrity:** build provenance and SBOM attestations on every tarball, release tags
  that only the release deploy key can create and nobody can move, and immutable releases
  ([MAINTAINERS.md § Repository settings](MAINTAINERS.md#repository-settings)).
- **Native alerts:** GitHub secret scanning with push protection, and Dependabot alerts.
