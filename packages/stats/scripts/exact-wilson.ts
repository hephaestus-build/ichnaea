// Exact two-sided coverage of the Wilson interval at n, by enumerating x = 0..n, over a fine p grid.
// Usage: node scripts/exact-wilson.ts 20
import { wilson } from "../src/index.ts";

const n = Number(process.argv[2] ?? 20);
const pmf = (x: number, p: number): number => {
  let c = 1;
  for (let i = 1; i <= x; i++) c = (c * (n - x + i)) / i;
  return c * p ** x * (1 - p) ** (n - x);
};
const intervals = Array.from({ length: n + 1 }, (_, x) =>
  wilson({ successes: x, trials: n }, 0.95),
);
let min = 1;
let at = 0;
for (let k = 1; k < 10000; k++) {
  const p = k / 10000;
  let c = 0;
  intervals.forEach((i, x) => (c += i.lower <= p && p <= i.upper ? pmf(x, p) : 0));
  if (c < min) [min, at] = [c, p];
}
let at95 = 0;
intervals.forEach((i, x) => (at95 += i.lower <= 0.95 && 0.95 <= i.upper ? pmf(x, 0.95) : 0));
console.log(
  `n=${n}: exact coverage at p=0.95 is ${at95.toFixed(4)}; minimum ${min.toFixed(4)} at p=${at}`,
);
