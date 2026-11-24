interface BinaryCell {
  readonly trials: number;
  readonly successes: number;
}
type ArmCells = ReadonlyMap<string, ReadonlyMap<string, BinaryCell>>;
type Blocks = ReadonlyMap<number, ArmCells>;

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const centre = mean(values);
  return values.reduce((sum, value) => sum + (value - centre) ** 2, 0) / (values.length - 1);
}

/** Descriptive noise of a fixed set of cases. The two variance components have different units. */
export interface NoiseSummary {
  readonly arms: {
    readonly arm: string;
    readonly withinCaseVariance: number | null;
    readonly replicatedCells: number;
    readonly caseDispersion: number | null;
  }[];
  readonly betweenBlockVariance: number | null;
  readonly contrastBlocks: number;
}

/** Counts used for each component. A missing block contrast cannot enter the variance. */
export function noiseSummary(
  arms: readonly string[],
  byCase: ArmCells,
  byBlock: Blocks,
  plannedCases: readonly string[],
  pair: { readonly base: string; readonly candidate: string } | undefined,
): NoiseSummary {
  const summaries = arms.map((arm) => {
    const within = [...byBlock.values()].flatMap((block) =>
      [...(block.get(arm)?.values() ?? [])]
        .filter((cell) => cell.trials > 1)
        .map((cell) => {
          const passRate = cell.successes / cell.trials;
          return (passRate * (1 - passRate) * cell.trials) / (cell.trials - 1);
        }),
    );
    const caseMeans = [...(byCase.get(arm)?.values() ?? [])]
      .filter((cell) => cell.trials > 0)
      .map((cell) => cell.successes / cell.trials);
    return {
      arm,
      replicatedCells: within.length,
      withinCaseVariance: within.length ? mean(within) : null,
      caseDispersion: variance(caseMeans),
    };
  });
  const contrasts = [];
  if (pair && plannedCases.length > 0) {
    for (const block of byBlock.values()) {
      const base = block.get(pair.base);
      const candidate = block.get(pair.candidate);
      let total = 0;
      let complete = true;
      for (const id of plannedCases) {
        const b = base?.get(id);
        const c = candidate?.get(id);
        if (!b?.trials || !c?.trials) {
          complete = false;
          break;
        }
        total += c.successes / c.trials - b.successes / b.trials;
      }
      if (complete) contrasts.push(total / plannedCases.length);
    }
  }
  return {
    arms: summaries,
    betweenBlockVariance: variance(contrasts),
    contrastBlocks: contrasts.length,
  };
}
