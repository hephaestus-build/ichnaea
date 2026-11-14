# Contributing to Ichnaea

Thank you for helping. Ichnaea is a general framework: it must work for any GenAI application.

## Ground rules

1. **No application special cases in the framework.** A behaviour that only one application needs
   belongs in that application's plugin or suite. `pnpm lint` fails on known application terms.
2. **No personal data, production content, secrets or private data.** Examples and fixtures are
   synthetic. Never commit real users' text, real run records or credentials.
3. **Every claim has a test that could fail.** A statistical method matches published reference
   values and passes its simulation checks within a stated Monte Carlo tolerance.
4. **Contracts change carefully.** zod is the source and the generated JSON Schema is normative.
   No refinements, transforms or defaults in contract schemas. Additive changes keep the major
   version. Every field has a data class.
5. **A change that can flip a verdict on the same records is a major change** of that package.

## Workflow

1. Open an issue first for anything larger than a fix.
2. Branch from `main`. Use [Conventional Commits](https://www.conventionalcommits.org/) with a scope
   from `commitlint.config.ts`, for example `feat(contracts): case sets record their pools`.
3. Run `pnpm check` before you push.
4. Add a changeset (`pnpm changeset`) for every change to a published package, written for its users.
5. Open a pull request. CI must be green and a maintainer must approve it.

## Regenerate artefacts

`pnpm generate` rewrites the JSON Schema files and the shared fixtures from their sources. Commit
the result. Never edit generated files by hand.

## Licence of contributions

By contributing you agree that your code is licensed under MIT and your prose under CC BY 4.0, as
stated in `LICENSE` and `LICENSE-docs.md`.
