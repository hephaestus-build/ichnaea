// Groups the reason codes for the reference page. The codes, their meaning and the card's wording
// come from `REASONS` in the contracts, the one source that `report` reads too. This module only
// orders them into sections.
import {
  CONTEXT_SLOTS,
  REASON_CODES,
  REASON_PARAMS,
  REASONS,
  type Reason,
  type ReasonCode,
} from "@hephaestus-build/ichnaea/contracts";

/** One reason, with the slots its sentences use, split by who fills them. */
export type ReasonEntry = { readonly code: ReasonCode } & Reason & {
    /** The reason's own parameters, which the code that emits it supplies. */
    readonly params: readonly string[];
    /** The slots that the report fills from the decision and the suite. */
    readonly context: readonly string[];
  };

export interface ReasonSection {
  readonly title: string;
  /** Says what the section covers, and what the current build does with it. */
  readonly intro: string;
  readonly reasons: ReadonlyArray<ReasonEntry>;
}

const SECTIONS: ReadonlyArray<{
  title: string;
  intro: string;
  match: (code: ReasonCode, reason: Reason) => boolean;
}> = [
  {
    title: "Verdicts",
    intro: "Why a run, or one of its measures, got its verdict.",
    match: (code, reason) =>
      reason.scope === "decision" && !/^(INVALID|ESTIMATE_ONLY|INTERVAL_UNAVAILABLE)_/.test(code),
  },
  {
    title: "Invalid runs",
    intro: "Why a run cannot be trusted. An INVALID run gives no verdict about your change.",
    match: (code) => code.startsWith("INVALID_"),
  },
  {
    title: "Estimates only",
    intro: "Why a measure shows numbers but no verdict.",
    match: (code) => code.startsWith("ESTIMATE_ONLY_"),
  },
  {
    title: "Intervals not available",
    intro:
      'Why a number has no interval. The card says "No interval yet:" followed by the sentence below.',
    match: (code) => code.startsWith("INTERVAL_UNAVAILABLE_"),
  },
  {
    title: "Model judges (planned)",
    intro:
      "Judge calibration is planned: today only its schemas exist. These codes describe how a judge-based measure will report its calibration.",
    match: (_, reason) => reason.scope === "judge",
  },
];

const CONTEXT: ReadonlySet<string> = new Set(CONTEXT_SLOTS);

function entry(code: ReasonCode): ReasonEntry {
  const reason = REASONS[code];
  const texts = [...reason.sentences.map((sentence) => sentence.text), reason.action ?? ""];
  const slots = new Set(
    texts.flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "")),
  );
  return {
    code,
    ...reason,
    params: [...REASON_PARAMS[code]],
    context: [...slots].filter((slot) => CONTEXT.has(slot)),
  };
}

/** Every reason code, in its section, in the order the contracts list them. */
export function reasonSections(): ReasonSection[] {
  return SECTIONS.map(({ title, intro, match }) => ({
    title,
    intro,
    reasons: REASON_CODES.filter((code) => match(code, REASONS[code])).map((code) => entry(code)),
  }));
}

/** What a slot holds, for slots whose name alone could mislead. Shown wherever a reason uses them. */
export const SLOT_NOTES: Readonly<Record<string, string>> = {
  arm: "the name of an arm, as the plan gives it",
  side: "base or candidate",
};

/** Splits a sentence template into text and `{slot}` parts, so the page can mark the slots. */
export function templateParts(
  text: string,
): Array<{ readonly slot: boolean; readonly text: string }> {
  return text
    .split(/(\{\w+\})/)
    .filter(Boolean)
    .map((part) => ({ slot: /^\{\w+\}$/.test(part), text: part }));
}
