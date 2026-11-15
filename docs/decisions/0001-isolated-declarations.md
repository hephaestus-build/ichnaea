# 0001. isolatedDeclarations outside the schema modules

Status: Accepted
Date: 2026-11-15

## Context

The `contracts` package writes each record as a zod schema. Its TypeScript type is inferred from
the schema.

The compiler option `isolatedDeclarations` requires an explicit type on every exported value.
For a zod schema, that type is the full zod type of the schema. We would have to write each
schema twice: once as code and once as a type.

The other modules have no such cost. They hold the canonical form, the identity and digest
rules, the egress projection and the readers. Their exports are functions and a few constants.

## Decision

The exemption covers the schema modules only: `src/primitives.ts` and every file under
`src/records/`.

Every other module under `src/` is compiled with `isolatedDeclarations`. This includes an exported
constant whose type is inferred, which a lint rule for return types cannot see.

`scripts/typecheck.ts` runs the check. It runs the compiler with `--isolatedDeclarations` on each
package and fails on any error under `src/` outside the exempt files. The exemption is one pattern
in `scripts/isolated-declarations.ts`.

A committed API Extractor report gates every change to the public types, so a declaration
change is reviewed even where the compiler does not force an explicit type.

## Evidence

- With the option on, the compiler reports 505 errors in the 11 schema modules, and none in
  the 12 other modules under `src/`.
- Those 11 modules export 82 constants. Each one is a schema, and each one has an inferred type.
- A test in `scripts/isolated-declarations.test.ts` runs the check on a small repository. It
  fails on an exported constant with an inferred type and on an exported function without a
  return type in a logic module. It passes the same code in the schema modules. It fails when
  the compiler does not start.

## Consequences

- A change to a schema needs no hand-written type.
- A new logic module has explicit types from its first line.
- A schema module that a contributor adds outside `primitives.ts` and `records/` is checked. To
  exempt it, change the pattern and this record.
- The pattern and the compiler flags are tested, so a change to either fails a test.
