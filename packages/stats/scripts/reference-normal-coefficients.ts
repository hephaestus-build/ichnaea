// Writes test/reference-normal-coefficients.json: the coefficients of R 4.5.2's pnorm (Cody) and
// qnorm (AS 241), as printed in R's source, so a test can pin src/normal-coefficients.ts to them. Test-only:
//   node scripts/reference-normal-coefficients.ts
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

writeFileSync(
  join(import.meta.dirname, "..", "test", "reference-normal-coefficients.json"),
  `${JSON.stringify({ oracle: `R source, wch/r-source tag ${TAG}, src/nmath`, pnorm, qnorm }, null, 2)}\n`,
);
