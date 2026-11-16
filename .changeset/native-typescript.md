---
"@hephaestus-build/ichnaea-contracts": minor
"@hephaestus-build/ichnaea-core": minor
"@hephaestus-build/ichnaea-decide": minor
"@hephaestus-build/ichnaea-report": minor
"@hephaestus-build/ichnaea-stats": minor
---

The packages ship their TypeScript sources, with no build step and no `dist/`, and need Node 24 or later. Use Ichnaea from a git submodule pinned to a commit, linked into your pnpm workspace, as the README shows: Node does not run TypeScript from `node_modules`, so a packed tarball does not run.
