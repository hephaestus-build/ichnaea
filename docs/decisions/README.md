# Decision records

A decision record states one choice that the code depends on, and why it was made.
Code, tests and docs cite a record by its number, for example "decision 0002".
They never cite a private note, a review or a ticket that a reader cannot open.
`pnpm run lint` fails on a few such citations. See `scripts/check-purity.ts`.

## Format

Each record is one file, `NNNN-short-title.md`. The number is four digits and is never reused.

A record has these parts, in this order:

1. A title.
2. `Status:` and `Date:`. The status is `Accepted`, or `Superseded by NNNN`.
3. **Context.** The problem, in a few sentences.
4. **Decision.** What we do, stated as a rule.
5. **Evidence.** The facts and numbers that support it, stated in place.
6. **Consequences.** What changes for a reader of the code, and what it costs.

A decision is changed by a new record that supersedes it. The old record stays, with its status
changed.
