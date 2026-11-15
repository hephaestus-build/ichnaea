# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/hephaestus-build/ichnaea/security/advisories/new).
Do not open a public issue. We aim to acknowledge a report within five working days.

## Scope and trust model

Ichnaea is a library and a CLI. It runs plugins and configuration files as trusted code and does
not sandbox them. It listens on no network port. Every record field carries a data class, and the
egress projection drops unknown and unclassified fields; secret redaction at capture time arrives
with the runner and is not built yet.

## Supported versions

Nothing is released yet. Once releases exist, the latest minor version of each package receives
security fixes.
