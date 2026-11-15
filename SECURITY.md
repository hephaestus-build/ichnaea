# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/hephaestus-build/ichnaea/security/advisories/new).
Do not open a public issue. We aim to acknowledge a report within five working days.

## Scope and trust model

Ichnaea is a library and a CLI. It runs plugins and configuration files as trusted code and does
not sandbox them. It listens on no network port. Records never hold secrets: configuration capture
redacts by name and by pattern. Releases will be published with npm provenance.

## Supported versions

Nothing is released yet. Once releases exist, the latest minor version of each package receives
security fixes.
