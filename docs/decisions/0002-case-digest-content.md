# 0002. What a case digest hashes

Status: Accepted
Date: 2026-11-15

## Context

The digest of a case, and through it the digest of a case set, says which cases a result is about.
Results that carry the same digest are pooled. Two cases that differ in anything that can change a
result must not share a digest.

The first version of the digest left out several members. Changing a case's `criticality`,
`slices`, `provenance.selection`, `dataClass` or `exposure` left the case-set digest unchanged.
Results for different sets could then pool.

## Decision

A case digest hashes what a case asks, how it is graded and how its result is read. Where the
case sits in a set is a fact of the set, and the set entry hashes it.

- The case digest hashes `unit`, `dataClass`, `input`, `turns`, `fixtures`, `references`,
  `family`, `slices`, `criticality` and `provenance`;
- of `provenance`: `source`, `selection`, `created`, `collected`, `licence`, `exposure`,
  `generator`, `reusedDataset` and `finding`.

A case digest leaves out six members, each for a reason:

- `schema`: a new major version that keeps this list keeps the digests.
- `validation`: the review status. Reviewing a case does not change what it asks or grades.
- `provenance.author`: a pointer to a person, erased with them. Erasing it keeps the digest.
- `caseSet`: a pointer to the set that holds the case. The same case in another set, or in a
  renamed set, keeps its digest. The set's own digest covers its membership.
- `id` and `pool`: where the case sits in its set. A screened case copied under a new ID, or
  moved into the sealed pool, keeps its digest, so a check that refuses cases already used in
  screening still finds it. Caches keyed by the case digest survive a rename or a move.

A case-set digest hashes each entry's `id`, `digest`, `pool` and `family`, sorted by `id`. It
therefore changes when a case moves pool or changes ID. Renaming a set changes no digest: a set is
identified by the digest of its entries.

`DIGEST_RULES` in `packages/contracts/src/identity.ts` is the one home of these lists. Changing a
list is a new major version of the contract.

## Evidence

- A member that is not listed is neither hashed nor excluded by accident: a test requires that
  every member of the writer schema is in `members` or in `excluded`, with a reason.
- A test changes each of the 9 other hashed case members and each of the 9 hashed provenance
  members, one by one, and expects a new digest. It changes each excluded member and expects the same digest. The
  expected result comes from a list that the test holds by hand, not from `DIGEST_RULES`.
- The same test changes every leaf of generated cases to another valid value and applies the
  same list.
- The committed vectors include one case for each of the 5 provenance arms, and one change for
  each hashed provenance member. A Python implementation that shares no code with the package
  recomputes them in CI.
- A property test moves a case to another pool, gives it another ID and renames its set. The case
  digest stays the same each time; the set digest changes for the first two and not for the third.
- The mutation script moves each of the 9 provenance members out of the digest in turn, and moves
  `author`, `caseSet`, `id`, `pool` and `validation` in. Every one of these changes fails a test.

## Consequences

- Changing any one case changes its digest and the digest of its set.
- A case keeps its digest when a person is erased, when it is reviewed, when it moves to another
  set or pool, and when its ID changes.
- A new member of the case record is not hashed until a rule lists it, and a test fails until it
  is listed as hashed or excluded.
