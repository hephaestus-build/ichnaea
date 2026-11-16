---
"@hephaestus-build/ichnaea-contracts": minor
"@hephaestus-build/ichnaea-core": minor
"@hephaestus-build/ichnaea-decide": minor
"@hephaestus-build/ichnaea-report": minor
"@hephaestus-build/ichnaea-stats": minor
---

Every package exports its TypeScript sources under the `@hephaestus-build/source` condition. A project that links Ichnaea from a checkout, for example a git submodule in a workspace, runs it without a build: `node --conditions=@hephaestus-build/source` (Node 22.18 or later) or `bun --conditions=@hephaestus-build/source`, and `"customConditions": ["@hephaestus-build/source"]` in its `tsconfig.json` for the types. Without the condition, nothing changes: the packages resolve to `dist`.
