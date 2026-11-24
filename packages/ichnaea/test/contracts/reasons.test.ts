// The reason codes and the card's wording: one entry per code, and every template follows the card
// rules that a template can break on its own (the card's output lint checks the rest).
import { describe, expect, it } from "vitest";

import {
  CARD_LABELS,
  CONTEXT_SLOTS,
  REASON_CODES,
  REASON_PARAMS,
  REASONS,
  reasonFor,
  type ReasonCode,
} from "../../src/contracts/index.ts";

const entries = REASON_CODES.map((code) => [code, REASONS[code]] as const);
const texts = entries.flatMap(([code, r]) => [
  ...r.sentences.map((s) => ({ code, key: s.key, text: s.text })),
  ...(r.action === undefined ? [] : [{ code, key: "action", text: r.action }]),
]);

/** Words the card never uses, with the rule each breaks. */
const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bat worst\b/i, "no unvalidated confidence claim"],
  [/\bsafe\b/i, "never 'safe'"],
  [/\bsignifican(t|ce)\b/i, "never 'significant'"],
  [/\b(better|improve[sd]?|improvement|gain)\b/i, "no improvement claim"],
  [/n't\b|n’t\b/, "no negative contractions"],
  [/\b(please|sorry)\b/i, "no 'please' or 'sorry'"],
  [/!/, "no exclamation mark"],
  [
    /\b(behaviour|honour|colour|favour|labour|catalogue|centre|licence|artefact|\w+is(e|ed|es|ing|ation)|analys(e|ed|es|ing))\b/i,
    "American spelling",
  ],
  [/[a-z]'s\b/i, "the apostrophe is ’"],
];
/** Words that end like a British "-ise" spelling but are American spelling too. */
const AMERICAN = new Set([
  "arise",
  "arises",
  "otherwise",
  "precise",
  "precisely",
  "noise",
  "raise",
  "raised",
  "raises",
  "promise",
  "exercise",
  "advise",
  "surprise",
  "concise",
  "wise",
  "likewise",
  "rise",
  "rises",
  "revise",
  "revised",
]);

/** The words of a sentence, a slot counting as one. */
const words = (sentence: string): number => sentence.trim().split(/\s+/).filter(Boolean).length;

describe("REASONS", () => {
  it("has one entry for each code, in the order of REASON_CODES", () => {
    expect(Object.keys(REASONS)).toEqual([...REASON_CODES]);
    expect(new Set(REASON_CODES).size).toBe(REASON_CODES.length);
  });

  it("finds a reason by code and refuses a string that is not a code", () => {
    expect(reasonFor("PASS")).toBe(REASONS.PASS);
    expect(reasonFor("toString")).toBeUndefined();
    expect(reasonFor("PASS ")).toBeUndefined();
  });

  it("names only card labels, and a label's code family matches it", () => {
    const labels = new Set<string>(CARD_LABELS.map((l) => l.label));
    for (const [code, r] of entries) {
      for (const label of r.labels) expect(labels, code).toContain(label);
      if (code.startsWith("INVALID_")) expect(r.labels, code).toEqual(["Invalid"]);
      if (code.startsWith("ESTIMATE_ONLY_")) expect(r.labels, code).toEqual(["Estimate only"]);
      if (r.scope === "judge") expect(r.labels, code).toEqual([]);
    }
  });

  it("gives ✓ to PASS alone", () => {
    expect(CARD_LABELS.filter((l) => l.symbol === "✓").map((l) => l.label)).toEqual(["Pass"]);
  });

  it("points each detailed reason to a judge status that has no parent itself", () => {
    const statuses: ReasonCode[] = [
      "JUDGE_DIAGNOSTIC",
      "JUDGE_NOT_COVERED",
      "JUDGE_CALIBRATION_EXPIRED",
    ];
    for (const [code, r] of entries) {
      if (r.parent === undefined) continue;
      expect(statuses, code).toContain(r.parent);
      expect(REASONS[r.parent].parent, code).toBeUndefined();
      expect(r.action, `${code} names the next step`).toBeDefined();
    }
  });

  it("names the next step for every INVALID and ESTIMATE ONLY reason", () => {
    for (const [code, r] of entries)
      if (
        r.labels.includes("Invalid") ||
        (code.startsWith("ESTIMATE_ONLY_") && code !== "ESTIMATE_ONLY_NO_METHOD")
      )
        expect(r.action, code).toBeDefined();
  });

  it("keys each reason's sentences uniquely", () => {
    for (const [code, r] of entries)
      expect(new Set(r.sentences.map((s) => s.key)).size, code).toBe(r.sentences.length);
  });

  it("fills every slot from the context or from the reason's own parameters, and uses every parameter", () => {
    const context = new Set<string>(CONTEXT_SLOTS);
    for (const [code] of entries) {
      const params = new Set<string>(REASON_PARAMS[code]);
      const slots = new Set(
        texts
          .filter((t) => t.code === code)
          .flatMap((t) => [...t.text.matchAll(/\{([^}]*)\}/g)].map((m) => m[1] as string)),
      );
      for (const slot of slots)
        expect(context.has(slot) || params.has(slot), `${code}: {${slot}} has no source`).toBe(
          true,
        );
      for (const param of params) {
        expect(slots, `${code}: parameter ${param} is never shown`).toContain(param);
        expect(context.has(param), `${code}: parameter ${param} shadows a context slot`).toBe(
          false,
        );
      }
    }
  });

  it.each(BANNED)("keeps the card rule %s", (pattern, rule) => {
    for (const { code, key, text } of texts) {
      const hits = (text.match(new RegExp(pattern, "gi")) ?? []).filter(
        (w) => !AMERICAN.has(w.toLowerCase()),
      );
      expect(hits, `${code}/${key} breaks "${rule}": ${text}`).toEqual([]);
    }
  });

  it("keeps every sentence at 25 words or fewer", () => {
    for (const { code, key, text } of texts)
      for (const sentence of text.split(/(?<=\.)\s+/))
        expect(words(sentence), `${code}/${key}: ${sentence}`).toBeLessThanOrEqual(25);
  });

  it("claims run-to-run noise only where every case has two trials", () => {
    for (const [code, r] of entries)
      for (const s of r.sentences)
        if (/run-to-run noise/.test(s.text))
          expect(s.when, `${code}/${s.key}`).not.toMatch(/one trial per arm/);
  });

  it("keeps PASS words for PASS", () => {
    for (const { code, key, text } of texts) {
      if (code === "PASS") continue;
      expect(text, `${code}/${key}`).not.toMatch(/With 95% confidence|is non-inferior/);
      for (const m of text.matchAll(/\bPass\b/g))
        expect(text.slice(0, m.index), `${code}/${key}`).toMatch(
          /(not a statistical|of a|make a|reach a)\s*$/,
        );
    }
  });

  it("defines a detected drop as Inconclusive and reserves Regression for a randomized block result", () => {
    expect(REASONS.DROP_IN_THESE_RUNS_ONLY.labels).toEqual(["Inconclusive"]);
    expect(REASONS.DROP_IN_THESE_RUNS_ONLY.sentences[0]?.text).toBe(
      "A drop was detected in these runs.",
    );
    expect(REASONS.REGRESSION_DETECTED.meaning).toContain("Reserved");
  });

  it("calls a missing trial missing, never a failure", () => {
    for (const code of ["INVALID_COVERAGE", "MISSING_TRIALS_CHANGE_VERDICT"] as const) {
      const missing = REASONS[code].sentences.find((s) => s.key === "missing")?.text ?? "";
      expect(missing, code).toMatch(/missing/i);
      expect(missing.replace("missing, not wrong", ""), code).not.toMatch(
        /\b(failed|broke|error|wrong)\b/,
      );
    }
  });

  it('renders every unavailable interval as "No interval yet:" and a reason', () => {
    const unavailable = REASON_CODES.filter((c) => c.startsWith("INTERVAL_UNAVAILABLE_"));
    expect(unavailable.length).toBeGreaterThan(0);
    for (const code of unavailable)
      for (const s of REASONS[code].sentences) expect(s.text, code).toMatch(/^No interval yet: \S/);
    expect(
      REASONS.INTERVAL_UNAVAILABLE_NO_METHOD.sentences[0]?.text.replace("{valueType}", "score"),
    ).toBe("No interval yet: no validated method for score measures.");
    for (const { code, text } of texts) expect(text, code).not.toMatch(/\bno bound\b/i);
  });

  it("uses the user-facing vocabulary: limit, noise check, base and candidate, and sentence-case labels", () => {
    const facing = [
      ...CARD_LABELS.map((l) => ({ code: "label", text: l.label })),
      ...entries.map(([code, r]) => ({ code, text: r.meaning })),
      ...texts,
    ];
    for (const { code, text } of facing) {
      const prose = text.replaceAll("{margin}", "");
      expect(prose, code).not.toMatch(/\bmargins?\b/i);
      expect(prose, code).not.toMatch(/A\/A/);
      expect(prose.replaceAll("{arm}", ""), code).not.toMatch(/\barms?\b|arm’s/i);
      expect(prose, code).not.toMatch(/\b(PASS|REGRESSION|INCONCLUSIVE|INVALID)\b/);
    }
  });

  it("never labels the absence of a detected decrease as its own verdict", () => {
    expect(CARD_LABELS.map((l) => l.label)).toEqual([
      "Regression",
      "Pass",
      "Inconclusive",
      "Invalid",
      "Estimate only",
    ]);
    expect(REASONS.NO_DECREASE_DETECTED.labels).toEqual(["Inconclusive"]);
    expect(REASONS.NO_DECREASE_DETECTED.sentences[0]?.text).toBe(
      "No decrease detected. The data cannot rule out a decrease larger than your limit of {margin} points.",
    );
  });

  it("never lets an opaque arm name stand for a side: the side comes from the decision", () => {
    for (const { code, key, text } of texts)
      for (const m of text.matchAll(/\{arm\}/g))
        expect(text.slice(0, m.index), `${code}/${key}`).toMatch(/\{side\} \($/);
  });
});
