// Groups the reason codes for the reference page. The codes, their meaning and the card's wording
// come from `REASONS` in the contracts, the one source that `report` reads too. This module only
// orders them into sections.
import {
  REASON_CODES,
  REASONS,
  type Reason,
  type ReasonCode,
} from "@hephaestus-build/ichnaea/contracts";

export interface ReasonSection {
  readonly title: string;
  /** Says what the section covers, and what the current build does with it. */
  readonly intro: string;
  readonly reasons: ReadonlyArray<{ readonly code: ReasonCode } & Reason>;
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
    intro: "Why a number is shown without an interval.",
    match: (code) => code.startsWith("INTERVAL_UNAVAILABLE_"),
  },
  {
    title: "Model judges (planned)",
    intro:
      "Judge calibration is planned: today only its schemas exist. These codes describe how a judge-based measure will report its calibration.",
    match: (_, reason) => reason.scope === "judge",
  },
];

/** Every reason code, in its section, in the order the contracts list them. */
export function reasonSections(): ReasonSection[] {
  return SECTIONS.map(({ title, intro, match }) => ({
    title,
    intro,
    reasons: REASON_CODES.filter((code) => match(code, REASONS[code])).map((code) => ({
      code,
      ...REASONS[code],
    })),
  }));
}

/** Splits a sentence template into text and `{slot}` parts, so the page can mark the slots. */
export function templateParts(
  text: string,
): Array<{ readonly slot: boolean; readonly text: string }> {
  return text
    .split(/(\{\w+\})/)
    .filter(Boolean)
    .map((part) => ({ slot: /^\{\w+\}$/.test(part), text: part }));
}
