// Writes test/stats/reference-normal-coefficients.json: the coefficients and branch bounds of R 4.5.2's
// pnorm (Cody) and qnorm (AS 241), as printed in R's source, so a test can pin
// src/normal-coefficients.ts to them. Test-only:
//   node scripts/stats/reference-normal-coefficients.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const TAG = "R-4-5-2";
const base = `https://raw.githubusercontent.com/wch/r-source/tags/${TAG}/src/nmath`;

async function source(file: string): Promise<string> {
  const response = await fetch(`${base}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return (await response.text()).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const literals = (text: string): string[] =>
  [...text.matchAll(/(?<![\w.])(\d*\.?\d+(?:[eE][-+]?\d+)?)\.?(?![\w])/g)].map((m) => m[1]!);
/** The polynomial coefficients: every literal with at least 10 significant digits. */
const long = (text: string): string[] =>
  literals(text).filter(
    (l) =>
      l
        .replace(/[eE].*$/, "")
        .replace(/[^0-9]/g, "")
        .replace(/^0+/, "").length >= 10,
  );

const pnormSource = await source("pnorm.c");
const pnorm: Record<string, string[]> = {};
for (const name of ["a", "b", "c", "d", "p", "q"]) {
  const match = new RegExp(`\\b${name}\\[\\d+\\]\\s*=\\s*\\{([^}]*)\\}`).exec(pnormSource);
  if (!match) throw new Error(`pnorm.c: no array ${name}`);
  pnorm[name] = literals(match[1]!);
}

const qnormSource = await source("qnorm.c");
const as241 = qnormSource.slice(
  qnormSource.indexOf("if (fabs(q) <= .425)"),
  qnormSource.indexOf("r >= 6.4e8"),
);
const all = long(as241);
if (all.length !== 45) throw new Error(`qnorm.c: expected 45 coefficients, found ${all.length}`);
const rational = (at: number) => ({
  numerator: all.slice(at, at + 8),
  denominator: all.slice(at + 8, at + 15),
});
const qnorm = { central: rational(0), low: rational(15), far: rational(30) };

/** The one capture of a pattern that must occur exactly once in the source. */
function single(text: string, pattern: RegExp, what: string): string {
  const matches = [...text.matchAll(new RegExp(pattern.source, "g"))];
  if (matches.length !== 1) throw new Error(`${what}: expected one match, found ${matches.length}`);
  return matches[0]![1]!;
}
const pnormBounds = {
  central: single(pnormSource, /if \(y <= ([\d.]+)\)/, "pnorm central bound"),
  lowerTail: single(pnormSource, /lower && (-[\d.]+) < x/, "pnorm lower tail bound"),
  upperTail: single(
    pnormSource,
    /lower && -[\d.]+ < x\s*&&\s*x < ([\d.]+)/,
    "pnorm upper tail bound",
  ),
  splitExponent: single(pnormSource, /trunc\(ldexp\(X, (\d+)\)\)/, "pnorm split exponent"),
};
const shifts = [...as241.matchAll(/r \+= -([\d.]+);/g)].map((m) => m[1]!);
if (shifts.length !== 2)
  throw new Error(`qnorm.c: expected two shifts of r, found ${shifts.length}`);
const qnormBounds = {
  central: single(as241, /fabs\(q\) <= ([\d.]+)\)/, "qnorm central bound"),
  centralSquare: single(as241, /r = ([\d.]+) - q \* q/, "qnorm central square"),
  low: single(as241, /if \(r <= ([\d.]+)\)/, "qnorm low bound"),
  lowShift: shifts[0]!,
  far: single(as241, /else if\(r <= ([\d.]+)\)/, "qnorm far bound"),
  farShift: shifts[1]!,
};

writeFileSync(
  join(import.meta.dirname, "..", "..", "test", "stats", "reference-normal-coefficients.json"),
  `${JSON.stringify(
    {
      oracle: `R source, wch/r-source tag ${TAG}, src/nmath`,
      pnorm,
      qnorm,
      pnormBounds,
      qnormBounds,
    },
    null,
    2,
  )}\n`,
);
