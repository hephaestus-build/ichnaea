# The confirmation sweep

The confirmation sweep runs on GitHub Actions in `.github/workflows/confirmation-sweep.yml`.
It searches for structures where the fixed-cases lower bound undercovers at a true difference of −margin.
Its results set the validated domain of non-inferiority.
Each output records the commit and the sha256 of each script that wrote it.

## The phases

| Phase           | Script and arguments                                                        | Seed base                          | Jobs                            |
| --------------- | --------------------------------------------------------------------------- | ---------------------------------- | ------------------------------- |
| A               | `study-heterogeneous.ts 0.05 0.30 0.005 i 51 9,10,11,12,14,17`              | 1 (the default)                    | 51, one per margin              |
| B               | the same with `11,12,13,14,15,16,17 --seed-base 1000000 --one-trial`        | 1,000,000                          | 51                              |
| C               | the same with `12,17 --seed-base 2000000`                                   | 2,000,000                          | 51                              |
| D               | `simulate-structures.ts` on the skip logs of A (with `--min-k 11`), B and C | 10,000,000, 11,000,000, 12,000,000 | 4, 16 and 4, each with 4 shards |
| E, large suites | `generate-structures.ts --one-trial`, then `simulate-structures.ts`         | 7,000,000, then 20,000,000         | 1, then 32                      |
| E, embedding    | `embed-worst.ts` on B's TSVs, then `simulate-structures.ts`                 | 21,000,000                         | 1, then 2                       |

`sweep-job.ts` runs the scripts for each job with these arguments.
Each job writes `job.json` next to the scripts' sidecars.
It records the commit, `ImageOS` and `ImageVersion`, the Node version, and the seeds of its shard.

A margin's rows depend only on the margin and the seed base, not on the worker count.
Thus one job per margin gives the same bytes as the server's 4 workers.
A simulated structure's seed depends on its index over the inputs, not on the shard.
D therefore reads the per-margin skip logs in the server's worker order: margins i ≡ 0 (mod 4) first, then 1, 2 and 3.

The collector job (`collect-sweep.ts`) downloads every artifact.
It fails if a margin, a shard or a structure is missing, if `check-sweep-provenance.ts` fails on an output, or if the large suites do not have the sha256 `e81bb2a4…53ae9`.
Then it writes `summary.json`, a deterministic archive of all artifacts (`confirmation-sweep.tar`), and `SHA256SUMS`.

## Dispatch

Dispatch from `main`, so the sweep runs on the statistics code that ships:

```sh
gh workflow run confirmation-sweep.yml --ref main
```

To run only some phases, set inputs to false, for example `-f d=false -f e-large=false -f e-embedded=false`.
D needs A, B and C in the same run. The embedding needs B.

Before the full sweep, run a pre-check of one margin, then compare its rows and skip logs with the server's (below):

```sh
gh workflow run confirmation-sweep.yml --ref main -f margins=13 -f d=false -f e-large=false -f e-embedded=false
```

A margin subset runs only A, B, C and the large suites.
D and the embedding need every margin, because a subset would change their seeds and rows, so the plan refuses them.
Every matrix stays within GitHub's limit of 256 jobs, and the plan refuses a larger one.

A second dispatch waits until the running sweep finishes.
If a job fails for a runner fault, use "Re-run failed jobs".
Every row is deterministic, so a rerun gives the same bytes.

## Verify a run

Run these from the repository root. `gh` puts each artifact in its own directory, so the first
step brings the summary, the checksums and the archive together.

```sh
gh run download <run-id> -n summary -n archive -D sweep
cp sweep/summary/summary.json sweep/summary/SHA256SUMS sweep/archive/confirmation-sweep.tar sweep/
(cd sweep && sha256sum -c SHA256SUMS)
mkdir sweep/in && tar -xf sweep/confirmation-sweep.tar -C sweep/in
git checkout <commit from summary.json>
node packages/ichnaea/scripts/stats/check-sweep-provenance.ts $(find sweep/in -name '*.tsv' -o -name '*.jsonl')
node packages/ichnaea/scripts/stats/collect-sweep.ts --in sweep/in --out sweep/again --phases A,B,C,D,E-large,E-embedded
cmp sweep/summary.json sweep/again/summary.json
```

For a pre-check, give `collect-sweep.ts` the run's phases and the same `--margins` as the dispatch.
The summary depends only on the artifacts, so the rebuilt summary must be byte-identical.

## Compare with the server runs

Phases A and B replicate runs on the server.
After you download both, `compare-replica.ts` compares them margin by margin:

```sh
node packages/ichnaea/scripts/stats/compare-replica.ts --phase B --actions in \
  --server-tsv server/confirm/sweep-{0,1,2,3}.tsv \
  --server-skips server/confirm/skips-{0,1,2,3}.jsonl --out replica-B.json
```

It compares:

- the TSV rows of every margin, byte for byte;
- each skip-log entry by id, in canonical form (RFC 8785), and the order of the entries in each margin;
- the counts in the server's files;
- each server worker file, rebuilt from the per-margin outputs.

Any difference makes the script fail.
Before a full dispatch, run it on one margin with `--margins 0` and the server rows of that margin.

The server outputs record commit `efc0201`.
Check them with `check-sweep-provenance.ts` from a checkout of `efc0201`, not from `main`.
The check requires each recorded file to have its recorded sha256 both at the recorded commit and at HEAD.
D's server sidecars list `test/support/simulate.ts` at sha256 `230349cb…4374`.
On `main` that file is `2e335859…8b81`, so the check fails at `main`'s HEAD.
This is not a defect.
The Actions outputs record `main`'s commit and pass at `main`.

## Results through a pull request

The pull request that uses the results commits `summary.json` and `SHA256SUMS`, not the raw artifacts.
The archive stays on the run for the artifact retention period.
Keep a copy elsewhere if the record must last longer.
Its sha256 in `SHA256SUMS` identifies the copy.

## A local dry run

`sweep-job.ts` and `collect-sweep.ts` take `--margins i,j` and `--jobs n` to run a small subset of the matrix on one machine.
The scripts refuse to run with uncommitted changes to tracked files.

## Sharded studies of the score methods

`.github/workflows/stats-study.yml` runs one study per dispatch: `score-type-i` (the score
permutation test's type-I study) or `score-ni` (the non-inferiority study). `study-plan.ts` holds
the table of each study's scripts and plans the jobs.

1. **prepare** (only `score-ni`): `score-ni-seeds.ts` checks the seeds and writes the seed manifest,
   and `collect-score-ni.ts structures` checks the structures. The manifest is kept as an artifact.
2. **screen:** J jobs (`jobs`, default 40). Job j runs shards 4j to 4j + 3 of 4J, one process each.
3. **select:** the collector checks every screen output and writes the points to rerun.
4. **recheck** or **confirm:** R jobs (`second_jobs`) over those points.
5. **verdict:** the collector writes `summary.json` and `summary.md` and fails when the study fails.
   It runs when a job before it failed too, so that the summary names what is missing.

A pilot lists screen shards in `pilot`, for example `0,57`, and stops after the screen. Each pilot
shard runs as its own job at the full screen's shard count, so its rows and time are the full run's.

```sh
gh workflow run stats-study.yml --ref main -f study=score-ni -f pilot=0,57
gh workflow run stats-study.yml --ref main -f study=score-ni -f jobs=40 -f second_jobs=40
```

No ICHNAEA_* variable is set. Any override makes a smoke run, which the collectors refuse without
`--smoke`. The plan refuses more than 256 jobs in one matrix.
