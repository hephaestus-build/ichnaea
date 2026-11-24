import {
  blockLowerBound,
  bothBoundsClear,
  sharpNullBlockP,
  sharpNullPairP,
  withinRunLowerBound,
} from "../stats/randomized-blocks.ts";
import type { Stratum } from "../stats/score-difference.ts";

import type { AssignedPair } from "./blocks.ts";

interface Count {
  successes: number;
  trials: number;
}

interface BlockValue {
  numerator: number;
  pairs: number;
}

interface TestedBlocks {
  readonly blocks: readonly BlockValue[];
  readonly strata: readonly Stratum[];
  readonly negative: number;
  readonly positive: number;
  readonly missing: number;
}

export interface BlockComparison {
  readonly blockP: number;
  readonly withinP: number;
  readonly blockLower: number;
  readonly withinLower: number;
  readonly withinPairs: number;
  readonly missing: number;
  readonly pass: boolean;
  readonly passReason?: string;
}

function tests(
  pairs: readonly AssignedPair[],
  mask: ReadonlySet<string>,
  scores: ReadonlyMap<string, number>,
  against: "regression" | "pass",
): TestedBlocks {
  const blocks = new Map<number, BlockValue>();
  const strata = new Map<number, Map<string, { base: Count; candidate: Count }>>();
  let negative = 0;
  let positive = 0;
  let missing = 0;
  for (const pair of pairs) {
    if (!mask.has(pair.case)) continue;
    const b = scores.get(pair.base);
    const c = scores.get(pair.candidate);
    missing += Number(b === undefined) + Number(c === undefined);
    const base = b ?? Number(against === "pass");
    const candidate = c ?? Number(against === "regression");
    const d = candidate - base;
    negative += Number(d < 0);
    positive += Number(d > 0);
    const group = blocks.get(pair.group) ?? { numerator: 0, pairs: 0 };
    group.numerator += d;
    group.pairs++;
    blocks.set(pair.group, group);
    const byCase = strata.get(pair.block) ?? new Map<string, { base: Count; candidate: Count }>();
    strata.set(pair.block, byCase);
    const count = byCase.get(pair.case) ?? {
      base: { trials: 0, successes: 0 },
      candidate: { trials: 0, successes: 0 },
    };
    count.base.trials++;
    count.base.successes += base;
    count.candidate.trials++;
    count.candidate.successes += candidate;
    byCase.set(pair.case, count);
  }
  return {
    blocks: [...blocks.values()],
    strata: [...strata.values()].flatMap((block) => [...block.values()]),
    negative,
    positive,
    missing,
  };
}

/** Limit exhaustive sign enumeration to the studied horizon. */
export const MAX_TEST_BLOCKS = 12;

/** The validated PASS domain after the boundary study, in the original case × block strata. */
function passDomain(
  cases: number,
  blocks: number,
  replicates: number,
  alpha: number,
  margin: number,
): boolean {
  return (
    [20, 60, 72].includes(cases) &&
    [5, 6, 7, 8].includes(blocks) &&
    replicates === 1 &&
    alpha === 0.05 &&
    [0.06, 0.1, 0.15].some((tested) => Math.abs(tested - margin) <= Number.EPSILON * tested)
  );
}

/** Evaluate the locked pairs after filling each missing trial against its claim. */
export function compareBlocks(
  pairs: readonly AssignedPair[],
  mask: ReadonlySet<string>,
  scores: ReadonlyMap<string, number>,
  options: {
    readonly alpha: number;
    readonly blockEligible: boolean;
    readonly replicates: number;
    readonly margin?: number;
  },
): BlockComparison {
  const reg = tests(pairs, mask, scores, "regression");
  const withinP = sharpNullPairP(reg.negative, reg.positive);
  const blockP = options.blockEligible ? sharpNullBlockP(reg.blocks) : 1;
  const ni = tests(pairs, mask, scores, "pass");
  const blockLower = options.blockEligible ? blockLowerBound(ni.blocks, options.alpha) : -1;
  const withinLower = withinRunLowerBound(ni.strata, options.alpha);
  const margin = options.margin;
  let passReason: string | undefined;
  if (margin === undefined) passReason = "no margin was registered";
  else if (!options.blockEligible) passReason = "too few effective randomized blocks";
  else if (new Set(pairs.map((pair) => pair.block)).size !== ni.blocks.length)
    passReason = "the validated PASS domain needs distinct contexts";
  else if (ni.missing > 0) passReason = "missing trials are outside the validated PASS domain";
  else if (!passDomain(mask.size, ni.blocks.length, options.replicates, options.alpha, margin))
    passReason = "the case count, block count or margin is outside the validated PASS domain";
  return {
    blockP,
    withinP,
    blockLower,
    withinLower,
    withinPairs: ni.strata.reduce((sum, row) => sum + row.base.trials, 0),
    missing: ni.missing,
    pass:
      passReason === undefined &&
      margin !== undefined &&
      bothBoundsClear(blockLower, withinLower, margin),
    ...(passReason === undefined ? {} : { passReason }),
  };
}
