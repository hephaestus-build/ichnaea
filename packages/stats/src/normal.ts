import cdf from "@stdlib/stats-base-dists-normal-cdf";
import quantile from "@stdlib/stats-base-dists-normal-quantile";

/** Standard normal distribution function. */
export function pnorm(x: number): number {
  return cdf(x, 0, 1);
}

/** Standard normal quantile function. */
export function qnorm(p: number): number {
  return quantile(p, 0, 1);
}

/** The critical value of a one- or two-sided interval at a confidence level. */
export function critical(level: number, sided: "two" | "lower" | "upper"): number {
  return qnorm(sided === "two" ? 1 - (1 - level) / 2 : level);
}
