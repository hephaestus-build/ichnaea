import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  cohenKappa,
  confusionTable,
  gwetAc1,
  krippendorffAlpha,
  rawAgreement,
} from "../../src/stats/index.ts";

const read = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), "utf8")) as T;

interface Inputs {
  tables: { id: string; table: number[][] }[];
  pairs: {
    id: string;
    categories: string[];
    first: (string | null)[];
    second: (string | null)[];
  }[];
  reliability: { id: string; units: (number | null)[][] }[];
}
interface RReference {
  tables: { id: string; raw: number; kappa: number; ac1: number; kappaIrr: number }[];
  pairs: { id: string; table: number[][]; kappa: number }[];
  reliability: {
    id: string;
    nominal: number;
    ordinal: number;
    interval: number;
    nominalIrrCAC: number;
    intervalIrrCAC: number;
  }[];
}

const inputs = read<Inputs>("reference-agreement-inputs.json");
const r = read<RReference>("reference-r-agreement.json");
// The base-R alpha, written from Krippendorff's definition by a separate author: one row per matrix.
const baseR = new Map(
  readFileSync(new URL("./reference-base-r-alpha.tsv", import.meta.url), "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const [id, nominal, ordinal, interval] = line.split("\t");
      return [
        id!,
        { nominal: Number(nominal), ordinal: Number(ordinal), interval: Number(interval) },
      ];
    }),
);
const TOLERANCE = 1e-12;
// irrCAC's krippen.alpha.raw rounds alpha to 5 decimals, so its comparison allows that rounding.
const IRRCAC_ALPHA_TOLERANCE = 6e-6;
const metrics = ["nominal", "ordinal", "interval"] as const;

describe("agreement against R (irr, irrCAC)", () => {
  it("covers every input with each oracle", () => {
    expect(r.tables.map((t) => t.id)).toEqual(inputs.tables.map((t) => t.id));
    expect(r.pairs.map((p) => p.id)).toEqual(inputs.pairs.map((p) => p.id));
    expect(r.reliability.map((u) => u.id)).toEqual(inputs.reliability.map((u) => u.id));
  });

  it.each(inputs.tables.map((t, i) => [t.id, t.table, r.tables[i]!] as const))(
    "table %s: raw agreement, kappa and AC1",
    (_id, table, expected) => {
      expect(Math.abs(rawAgreement(table) - expected.raw)).toBeLessThan(TOLERANCE);
      expect(Math.abs(cohenKappa(table) - expected.kappa)).toBeLessThan(TOLERANCE);
      expect(Math.abs(cohenKappa(table) - expected.kappaIrr)).toBeLessThan(TOLERANCE);
      expect(Math.abs(gwetAc1(table) - expected.ac1)).toBeLessThan(TOLERANCE);
    },
  );

  it.each(inputs.pairs.map((p, i) => [p.id, p, r.pairs[i]!] as const))(
    "labels %s: the same table as R, and irr's kappa",
    (_id, pair, expected) => {
      const built = confusionTable(pair.first, pair.second, pair.categories);
      expect(built.table).toEqual(expected.table);
      expect(built.pairs + built.skipped).toBe(pair.first.length);
      expect(Math.abs(cohenKappa(built.table) - expected.kappa)).toBeLessThan(TOLERANCE);
    },
  );

  it.each(inputs.reliability.map((u, i) => [u.id, u.units, r.reliability[i]!] as const))(
    "reliability %s: alpha with each metric",
    (id, units, fromR) => {
      for (const metric of metrics) {
        const alpha = krippendorffAlpha(units, metric);
        expect(Math.abs(alpha - fromR[metric])).toBeLessThan(TOLERANCE);
      }
      // The base-R implementation from the specification, an independent second author.
      const independent = baseR.get(id)!;
      for (const metric of metrics) {
        expect(Math.abs(krippendorffAlpha(units, metric) - independent[metric])).toBeLessThan(
          TOLERANCE,
        );
      }
      // irrCAC as a second R source, for the nominal and interval metrics only.
      expect(Math.abs(krippendorffAlpha(units, "nominal") - fromR.nominalIrrCAC)).toBeLessThan(
        IRRCAC_ALPHA_TOLERANCE,
      );
      expect(Math.abs(krippendorffAlpha(units, "interval") - fromR.intervalIrrCAC)).toBeLessThan(
        IRRCAC_ALPHA_TOLERANCE,
      );
    },
  );

  it("has a base-R value for every reliability matrix", () => {
    expect([...baseR.keys()]).toEqual(inputs.reliability.map((u) => u.id));
  });

  it("reproduces Krippendorff's published example (2011): 0.743, 0.815, 0.849", () => {
    const units = inputs.reliability.find((u) => u.id === "krippendorff-2011")!.units;
    expect(krippendorffAlpha(units, "nominal")).toBeCloseTo(0.743, 3);
    expect(krippendorffAlpha(units, "ordinal")).toBeCloseTo(0.815, 3);
    expect(krippendorffAlpha(units, "interval")).toBeCloseTo(0.849, 3);
  });
});

describe("agreement behaviour", () => {
  it("shows the prevalence effect: equal raw agreement, different kappa, stable AC1", () => {
    const balanced = [
      [40, 9],
      [6, 45],
    ];
    const skewed = [
      [80, 10],
      [5, 5],
    ];
    expect(rawAgreement(balanced)).toBe(rawAgreement(skewed));
    expect(cohenKappa(skewed)).toBeLessThan(cohenKappa(balanced) - 0.3);
    expect(gwetAc1(skewed)).toBeGreaterThan(gwetAc1(balanced));
  });

  it("counts declared but unused categories in AC1, and not in kappa", () => {
    const two = [
      [30, 5],
      [4, 11],
    ];
    const withUnused = [
      [30, 5, 0],
      [4, 11, 0],
      [0, 0, 0],
    ];
    expect(cohenKappa(withUnused)).toBeCloseTo(cohenKappa(two), 14);
    expect(gwetAc1(withUnused)).not.toBeCloseTo(gwetAc1(two), 6);
  });

  it("leaves out items with a missing label, and refuses an undeclared label", () => {
    const built = confusionTable(["yes", null, "no"], ["yes", "no", null], ["yes", "no"]);
    expect(built).toMatchObject({
      pairs: 1,
      skipped: 2,
      table: [
        [1, 0],
        [0, 0],
      ],
    });
    expect(() => confusionTable(["yes"], ["maybe"], ["yes", "no"])).toThrow(
      /'maybe' is not a declared category/,
    );
    expect(() => confusionTable(["yes"], [], ["yes", "no"])).toThrow(RangeError);
  });

  it("refuses tables that are not square, empty or fractional", () => {
    expect(() => cohenKappa([[1, 2]])).toThrow(RangeError);
    expect(() =>
      gwetAc1([
        [0, 0],
        [0, 0],
      ]),
    ).toThrow(/empty/);
    expect(() =>
      rawAgreement([
        [1.5, 0],
        [0, 1],
      ]),
    ).toThrow(/integers/);
  });

  it("returns NaN where the statistic is undefined, never a number that looks real", () => {
    // Both raters put everything in one category: chance explains all agreement.
    expect(
      cohenKappa([
        [5, 0],
        [0, 0],
      ]),
    ).toBeNaN();
    expect(
      gwetAc1([
        [5, 0],
        [0, 0],
      ]),
    ).toBe(1);
    // No variation at all, or nothing that can be paired.
    expect(
      krippendorffAlpha(
        [
          [2, 2],
          [2, 2],
        ],
        "nominal",
      ),
    ).toBeNaN();
    expect(
      krippendorffAlpha(
        [
          [1, null],
          [null, 2],
        ],
        "ordinal",
      ),
    ).toBeNaN();
  });

  it("leaves out a unit with one value, and uses only the order of values for the ordinal metric", () => {
    const units = [
      [1, 1, 2],
      [2, 2, 2],
      [3, 2, 3],
      [4, 4, null],
      [5, null, null],
    ];
    const without = units.slice(0, 4);
    for (const metric of metrics) {
      expect(krippendorffAlpha(units, metric)).toBe(krippendorffAlpha(without, metric));
    }
    const stretched = units.map((unit) => unit.map((v) => (v === null ? null : v ** 3)));
    expect(krippendorffAlpha(stretched, "ordinal")).toBeCloseTo(
      krippendorffAlpha(units, "ordinal"),
      14,
    );
    expect(krippendorffAlpha(stretched, "interval")).not.toBeCloseTo(
      krippendorffAlpha(units, "interval"),
      6,
    );
  });
});
