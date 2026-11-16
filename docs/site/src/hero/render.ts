// The README's hero figure: one real decision as an SVG. It shows the card's verdict, its evidence
// and statistical sentences, every case's passed and failed trials in both arms, and the change on
// an axis centred at 0 with the margin drawn. ICHNAEA-UX owns every sentence: they come from the
// card's view model (`card.json`) and this module only lays them out. Shapes are drawn from the raw
// numbers and labelled with the card's own `shown` text, so the figure and the card never disagree.
// Meaning never rests on colour alone: a passed trial is a filled square and a failed one an open
// square, a changed case has a bracket and its ID, and a bound that is not validated is dashed and
// says so.

/** One case's counts per arm, as the card lists them for every case. */
export interface CaseCounts {
  readonly case: string;
  readonly base: { readonly successes: number; readonly trials: number };
  readonly candidate: { readonly successes: number; readonly trials: number };
}

type Validity = "validated" | "descriptive" | "descriptive-single-trial";

/** The part of the card's view model that the hero reads. */
export interface HeroCard {
  readonly title: string;
  readonly evidence: { readonly sentence: string | null; readonly scope: string };
  readonly statistical: readonly string[];
  readonly policy: { readonly line: string };
  readonly reasons: readonly string[];
  readonly measure: {
    readonly change: {
      readonly estimate: number;
      readonly shown: string;
      readonly bound: {
        readonly value: number;
        readonly validity: Validity;
        readonly shown: string;
      };
    };
    /** The margin as a fraction in [0, 1]. */
    readonly margin: number;
    readonly cases: readonly CaseCounts[];
  };
}

export type Theme = "light" | "dark";

const PALETTE = {
  light: {
    background: "#ffffff",
    text: "#1f2328",
    muted: "#59636e",
    grid: "#d1d9e0",
    mark: "#1f2328",
    accent: "#cf222e",
  },
  dark: {
    background: "#0d1117",
    text: "#e6edf3",
    muted: "#9198a1",
    grid: "#3d444d",
    mark: "#e6edf3",
    accent: "#ff7b72",
  },
} as const;

const WIDTH = 760;
const LEFT = 110;
const RIGHT = 740;
const FONT = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Axis tick labels in points, with a true minus sign. Card numbers use the card's own text. */
export const tickLabel = (fraction: number): string => {
  const value = Math.round(fraction * 100);
  return value < 0 ? `−${-value}` : String(value);
};

/** The cases whose share of passed trials differs between the arms. */
export function changedCases(cases: readonly CaseCounts[]): CaseCounts[] {
  return cases.filter(
    (c) => c.base.successes * c.candidate.trials !== c.candidate.successes * c.base.trials,
  );
}

/** The part of each ID after the longest common prefix up to a dash: `support-03` → `03`. */
function shortIds(ids: readonly string[]): string[] {
  const prefix = ids.reduce((common, id) => {
    let i = 0;
    while (i < common.length && common[i] === id[i]) i++;
    return common.slice(0, i);
  }, ids[0] ?? "");
  const cut = prefix.lastIndexOf("-") + 1;
  return ids.map((id) => id.slice(cut));
}

const boundWords = (validity: Validity): string =>
  validity === "validated"
    ? "validated"
    : validity === "descriptive-single-trial"
      ? "not validated at one trial per case"
      : "not validated";

const counts = (arm: { successes: number; trials: number }): string =>
  `${arm.successes} of ${arm.trials}`;

/** The text alternative: the card's sentences, then what the strip and the axis show. */
export function heroAlt(card: HeroCard): string {
  const { change, margin, cases } = card.measure;
  const changed = changedCases(cases);
  const strip =
    changed.length === 0
      ? "No case changed between the arms."
      : `Changed cases: ${changed.map((c) => `${c.case} (${counts(c.base)} passed in the base, ${counts(c.candidate)} in the candidate)`).join(", ")}. Every other case passed as often in both arms.`;
  const descriptive = change.bound.validity === "validated" ? "" : "descriptive ";
  const bound = `The ${descriptive}one-sided 95% bound is ${change.bound.shown}, ${boundWords(change.bound.validity)}, against a margin of ${Math.round(margin * 100)} points.`;
  return [
    `Ichnaea's card for the bundled example. ${card.title.replace(/^\S+\s/, "")}.`,
    card.evidence.sentence ?? card.evidence.scope,
    ...card.statistical,
    strip,
    bound,
    card.policy.line,
    `Reason: ${card.reasons.join(", ")}.`,
  ].join(" ");
}

/** The figure as a standalone SVG document. */
export function renderHero(card: HeroCard, theme: Theme): string {
  const colors = PALETTE[theme];
  const { change, margin, cases } = card.measure;
  const parts: string[] = [];
  const text = (x: number, y: number, content: string, attributes = ""): void => {
    parts.push(`<text x="${x}" y="${y}" ${attributes}>${escape(content)}</text>`);
  };

  // 1. The card's title, evidence and statistical sentences.
  let y = 36;
  text(20, y, card.title, `font-size="20" font-weight="700" fill="${colors.text}"`);
  y += 26;
  text(
    20,
    y,
    card.evidence.sentence ?? card.evidence.scope,
    `font-size="14" font-weight="600" fill="${colors.text}"`,
  );
  for (const sentence of card.statistical) {
    y += 20;
    text(20, y, sentence, `font-size="13" fill="${colors.text}"`);
  }

  // 2. The paired strip: one column per case. Each arm's squares are counts, passes first, so the
  // order does not suggest a time order. A dash marks a trial that the arm lacks.
  const top = y + 40;
  const planned = Math.max(1, ...cases.flatMap((c) => [c.base.trials, c.candidate.trials]));
  const column = (RIGHT - LEFT) / Math.max(1, cases.length);
  const size = Math.min(12, (column - 10) / planned - 2);
  const changed = new Set(changedCases(cases).map((c) => c.case));
  const labels = shortIds(cases.map((c) => c.case));
  text(20, top + 20, "base", `font-size="13" fill="${colors.muted}"`);
  text(20, top + 44, "candidate", `font-size="13" fill="${colors.muted}"`);
  cases.forEach((c, i) => {
    const x0 = LEFT + i * column;
    text(
      x0 + column / 2,
      top,
      labels[i] ?? c.case,
      `font-size="12" text-anchor="middle" fill="${colors.muted}"`,
    );
    const row = (arm: { successes: number; trials: number }, rowY: number): void => {
      const width = planned * (size + 3) - 3;
      for (let t = 0; t < planned; t++) {
        const x = x0 + (column - width) / 2 + t * (size + 3);
        if (t >= arm.trials)
          parts.push(
            `<line x1="${x}" y1="${rowY + size / 2}" x2="${x + size}" y2="${rowY + size / 2}" stroke="${colors.muted}" stroke-width="1.5"/>`,
          );
        else
          parts.push(
            `<rect x="${x}" y="${rowY}" width="${size}" height="${size}" rx="2" fill="${t < arm.successes ? colors.mark : "none"}" stroke="${colors.mark}" stroke-width="1.5"/>`,
          );
      }
    };
    row(c.base, top + 9);
    row(c.candidate, top + 33);
    if (changed.has(c.case)) {
      const bracket = top + 54;
      parts.push(
        `<path d="M${x0 + 6} ${bracket} v6 h${column - 12} v-6" fill="none" stroke="${colors.accent}" stroke-width="2"/>`,
      );
      text(
        x0 + column / 2,
        bracket + 22,
        labels[i] ?? c.case,
        `font-size="12" font-weight="700" text-anchor="middle" fill="${colors.accent}"`,
      );
    }
  });
  const legendY = top + 100;
  if (changed.size > 0)
    text(
      LEFT,
      legendY,
      `changed: ${changed.size} of ${cases.length} cases`,
      `font-size="12" fill="${colors.muted}"`,
    );
  const legend = (x: number, label: string, mark: string): void => {
    parts.push(mark);
    text(x + 16, legendY, label, `font-size="12" fill="${colors.muted}"`);
  };
  const legendX = RIGHT - 250;
  legend(
    legendX,
    "passed",
    `<rect x="${legendX}" y="${legendY - 10}" width="11" height="11" rx="2" fill="${colors.mark}" stroke="${colors.mark}" stroke-width="1.5"/>`,
  );
  legend(
    legendX + 80,
    "failed",
    `<rect x="${legendX + 80}" y="${legendY - 10}" width="11" height="11" rx="2" fill="none" stroke="${colors.mark}" stroke-width="1.5"/>`,
  );
  if (cases.some((c) => c.base.trials < planned || c.candidate.trials < planned))
    legend(
      legendX + 160,
      "missing",
      `<line x1="${legendX + 160}" y1="${legendY - 4.5}" x2="${legendX + 171}" y2="${legendY - 4.5}" stroke="${colors.muted}" stroke-width="1.5"/>`,
    );

  // 3. The change on an axis centred at 0, with the margin and the bound.
  const low = Math.floor((Math.min(change.bound.value, -margin) - 0.05) * 10) / 10;
  const high = 0.1;
  const scale = (value: number): number => LEFT + ((value - low) / (high - low)) * (RIGHT - LEFT);
  const axisY = legendY + 64;
  parts.push(
    `<line x1="${LEFT}" y1="${axisY}" x2="${RIGHT}" y2="${axisY}" stroke="${colors.grid}" stroke-width="1"/>`,
  );
  for (let tick = Math.ceil(low * 10) / 10; tick <= high + 1e-9; tick += 0.1) {
    const x = scale(tick);
    parts.push(
      `<line x1="${x}" y1="${axisY - 4}" x2="${x}" y2="${axisY + 4}" stroke="${colors.grid}"/>`,
    );
    text(
      x,
      axisY + 20,
      tickLabel(tick),
      `font-size="11" text-anchor="middle" fill="${colors.muted}"`,
    );
  }
  text(20, axisY + 4, "change, points", `font-size="13" fill="${colors.muted}"`);
  const zero = scale(0);
  parts.push(
    `<line x1="${zero}" y1="${axisY - 26}" x2="${zero}" y2="${axisY + 4}" stroke="${colors.text}" stroke-width="1.5"/>`,
  );
  text(zero + 4, axisY - 30, "no change", `font-size="11" fill="${colors.muted}"`);
  const marginX = scale(-margin);
  parts.push(
    `<line x1="${marginX}" y1="${axisY - 26}" x2="${marginX}" y2="${axisY + 4}" stroke="${colors.text}" stroke-width="1.5" stroke-dasharray="2 2"/>`,
  );
  text(
    marginX + 4,
    axisY - 30,
    `margin ${tickLabel(-margin)}`,
    `font-size="11" fill="${colors.muted}"`,
  );
  const boundX = scale(change.bound.value);
  const estimateX = scale(change.estimate);
  const validated = change.bound.validity === "validated";
  parts.push(
    `<line x1="${boundX}" y1="${axisY - 10}" x2="${estimateX}" y2="${axisY - 10}" stroke="${colors.accent}" stroke-width="2.5" ${validated ? "" : 'stroke-dasharray="6 4"'}/>`,
  );
  parts.push(`<circle cx="${estimateX}" cy="${axisY - 10}" r="5" fill="${colors.accent}"/>`);
  text(
    estimateX + 9,
    axisY - 6,
    change.shown,
    `font-size="12" font-weight="700" fill="${colors.accent}"`,
  );
  const boundLabel = validated
    ? "one-sided 95% bound"
    : `descriptive one-sided 95% bound, ${boundWords(change.bound.validity)}`;
  // Below the tick labels, so a long label never runs into the margin or the estimate.
  parts.push(
    `<line x1="${boundX}" y1="${axisY - 10}" x2="${boundX}" y2="${axisY + 28}" stroke="${colors.muted}" stroke-width="1" stroke-dasharray="1 2"/>`,
  );
  text(
    boundX,
    axisY + 42,
    `${change.bound.shown} ${boundLabel}`,
    `font-size="11" fill="${colors.muted}"`,
  );

  // 4. The policy line and the reasons.
  const policyY = axisY + 78;
  text(20, policyY, card.policy.line, `font-size="13" font-weight="600" fill="${colors.text}"`);
  text(
    20,
    policyY + 20,
    `Reason: ${card.reasons.join(", ")}`,
    `font-size="12" fill="${colors.muted}"`,
  );

  const height = policyY + 36;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="title desc" font-family="${FONT}">`,
    `<title id="title">${escape(card.title)}</title>`,
    `<desc id="desc">${escape(heroAlt(card))}</desc>`,
    `<rect width="${WIDTH}" height="${height}" rx="8" fill="${colors.background}"/>`,
    ...parts,
    "</svg>",
    "",
  ].join("\n");
}
