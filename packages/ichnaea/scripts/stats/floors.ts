// Prints the zero-noise floors of the fixed-cases method and the sampled-cases floor.
import { fixedCasesFloor, sampledCasesFloor } from "../../src/stats/index.ts";

console.log("cases\tr=2 MN\tr=3 MN\tr=2 no-bc\tdesign r=2 z²/(nr+z²)\tsampled");
const z2 = 1.6448536269514722 ** 2;
for (const n of [17, 20, 25, 52, 60, 250]) {
  console.log(
    [
      n,
      fixedCasesFloor(n, 2),
      fixedCasesFloor(n, 3),
      fixedCasesFloor(n, 2, 0.05, { biasCorrection: false }),
      z2 / (n * 2 + z2),
      sampledCasesFloor(n),
    ]
      .map((v, i) => (i === 0 ? String(v) : (v as number).toFixed(4)))
      .join("\t"),
  );
}
