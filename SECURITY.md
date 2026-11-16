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
- We fix a confirmed vulnerability as soon as we can, in a new version on npm, and publish it as a
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

Ichnaea is 0.x on npm as `@tumaet/ichnaea`. **Only the latest version receives security fixes.**
A fix ships as a new version: a patch version, or a minor version when the fix breaks an
interface. Update to take it, and run `npm audit signatures`, as the
[README](README.md#check-what-you-installed) shows.

Every commit on `main` is signed. The release workflow stages a version only from a `v*` tag whose
commit is reachable from `main`, and a package owner approves each version on npm. The finish
workflow, which runs only `main`'s code, gives a version a GitHub release only if its provenance
names that tag and its commit on `main`. Until the first version is on npm, consumers pin a commit
of the `build` branch. A build commit names its `main` commit and is reproducible from it, as the
[README](README.md#before-the-first-npm-release) shows.

## Scope

Ichnaea is a library and a CLI that run on your machine. In scope:

- the code of the packages in this repository, the CLI included;
- the build branch: the build workflow, the build tree, its manifest and its SBOM, and the
  reproducibility check;
- the release process: the release workflows, the staged tarball and its provenance, the SBOM and
  the checksums;
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
- code that does not come from a signed commit on `main`: a version on npm without a provenance by
  the release workflow, or a build commit that is not reproducible from `main`;
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
- **Static analysis and dependency review:** CodeQL checks the TypeScript and Python code and the
  workflows on each push to `main` and each pull request from a branch of this repository, as
  GitHub's default setup that the organisation enables. It does not scan a pull request from a
  fork; a maintainer reads the code scanning alerts before such a merge. Dependency review blocks a pull request that adds a dependency with a high
  or critical advisory or an unlisted licence, and OpenSSF Scorecard rates the repository
  ([`.github/workflows/`](.github/workflows)). Results appear in the repository's Security tab.
- **Install policy:** pnpm installs a version only when it is at least 7 days old, runs no install
  script of a dependency, and refuses a version that was published with less trust evidence than
  an earlier version of the same package ([`pnpm-workspace.yaml`](pnpm-workspace.yaml)).
- **Workflow audit in CI:** actionlint and zizmor check every workflow on each pull request
  ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).
- **Build integrity:** only the build workflow's deploy key, held by a main-only environment,
  writes the `build` branch, and nobody force-pushes it. Each build commit has an SBOM and a
  manifest without install scripts, and CI rebuilds it byte for byte from its source commit
  ([MAINTAINERS.md § The build branch](MAINTAINERS.md#the-build-branch)).
- **Release integrity:** only the release team creates a `v*` tag, and nobody moves or deletes
  one. The release workflow can only stage a version on npm, with provenance and no token. A
  package owner approves each version with two-factor authentication, and GitHub releases are
  immutable ([MAINTAINERS.md § Releases](MAINTAINERS.md#releases), decision 0021).
- **Native alerts:** GitHub secret scanning with push protection, and Dependabot alerts.
