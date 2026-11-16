// The README's hero figure: one real decision as an SVG. It shows the card's verdict line, every
// trial of every case in both arms, and the change on an axis centred at 0 with the margin drawn.
// The words come from the card, which ICHNAEA-UX owns. This module only lays them out. Meaning is
// never carried by colour alone: a passed trial is a filled square, a failed one an open square, a
// changed case has a bracket and its ID, and an unvalidated bound is dashed and says so.

/** One trial's outcome: 1 passed, 0 failed, null missing. */
export type Outcome = 0 | 1 | null;

export interface HeroCase {
  readonly id: string;
  readonly base: readonly Outcome[];
  readonly candidate: readonly Outcome[];
}

export interface HeroInput {
  /** The card's title, for example `✗ Support answers · REGRESSION`. */
  readonly title: string;
  /** The card's evidence sentence. */
  readonly evidence: string;
  /** The card's policy line and reason codes, in one line. */
  readonly footer: string;
  readonly cases: readonly HeroCase[];
  /** The change and its one-sided 95% lower bound, as fractions (−0.25 is −25 points). */
  readonly change: {
    readonly estimate: number;
    readonly bound: number;
    readonly validated: boolean;
  };
  /** The margin as a positive fraction. */
  readonly margin: number;
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
const HEIGHT = 320;
const LEFT = 110;
const RIGHT = 740;
const FONT = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Points with one decimal, a true minus sign, and no trailing `.0`. */
export const points = (fraction: number): string => {
  const value = Math.round(fraction * 1000) / 10;
  const text = Math.abs(value).toFixed(1).replace(/\.0$/, "");
  return value < 0 ? `−${text}` : text;
};

const passes = (outcomes: readonly Outcome[]): number => outcomes.filter((o) => o === 1).length;
const completed = (outcomes: readonly Outcome[]): number =>
  outcomes.filter((o) => o !== null).length;

/** The cases whose share of passed trials differs between the arms. */
export function changedCases(cases: readonly HeroCase[]): HeroCase[] {
  return cases.filter(
    (c) => passes(c.base) * completed(c.candidate) !== passes(c.candidate) * completed(c.base),
  );
}

/** The shortest suffix that tells the case IDs apart, for the column labels: `support-03` → `03`. */
function shortIds(ids: readonly string[]): string[] {
  const prefix = ids.reduce((common, id) => {
    let i = 0;
    while (i < common.length && common[i] === id[i]) i++;
    return common.slice(0, i);
  }, ids[0] ?? "");
  const cut = prefix.lastIndexOf("-") + 1;
  return ids.map((id) => id.slice(cut));
}

/** The text alternative: every fact the figure shows, in sentences. */
export function heroAlt(input: HeroInput): string {
  const trials = input.cases[0]?.base.length ?? 0;
  const changed = changedCases(input.cases);
  const changes = changed
    .map(
      (c) =>
        `${c.id} (${passes(c.base)} of ${completed(c.base)} to ${passes(c.candidate)} of ${completed(c.candidate)})`,
    )
    .join(", ");
  const bound = input.change.validated
    ? `The one-sided 95% bound is ${points(input.change.bound)} points.`
    : `The descriptive one-sided 95% bound is ${points(input.change.bound)} points, not validated.`;
  return [
    `Ichnaea's decision for the bundled example: ${input.title.replace(/^\S+\s/, "")}.`,
    `${input.evidence}`,
    `Each of the ${input.cases.length} cases ran ${trials} trials in the base and in the candidate.`,
    changed.length === 0
      ? "No case changed."
      : `Changed cases: ${changes}. Every other case passed the same trials in both arms.`,
    `${bound} The margin is ${points(input.margin)} points.`,
    input.footer.replaceAll(" · ", ". ") + ".",
  ].join(" ");
}

/** The figure as a standalone SVG document. */
export function renderHero(input: HeroInput, theme: Theme): string {
  const colors = PALETTE[theme];
  const parts: string[] = [];
  const text = (x: number, y: number, content: string, attributes = ""): void => {
    parts.push(`<text x="${x}" y="${y}" ${attributes}>${escape(content)}</text>`);
  };

  // 1. The verdict line, from the card.
  text(20, 36, input.title, `font-size="20" font-weight="700" fill="${colors.text}"`);
  text(20, 62, input.evidence, `font-size="14" fill="${colors.text}"`);

  // 2. The paired strip: one column per case, the base's trials above the candidate's.
  const column = (RIGHT - LEFT) / Math.max(1, input.cases.length);
  const size = Math.min(12, (column - 10) / Math.max(1, input.cases[0]?.base.length ?? 1) - 2);
  const changed = new Set(changedCases(input.cases).map((c) => c.id));
  const labels = shortIds(input.cases.map((c) => c.id));
  text(20, 116, "base", `font-size="13" fill="${colors.muted}"`);
  text(20, 140, "candidate", `font-size="13" fill="${colors.muted}"`);
  input.cases.forEach((c, i) => {
    const x0 = LEFT + i * column;
    text(
      x0 + column / 2,
      96,
      labels[i] ?? c.id,
      `font-size="12" text-anchor="middle" fill="${colors.muted}"`,
    );
    const row = (outcomes: readonly Outcome[], y: number): void => {
      const width = outcomes.length * (size + 3) - 3;
      outcomes.forEach((outcome, t) => {
        const x = x0 + (column - width) / 2 + t * (size + 3);
        if (outcome === null)
          parts.push(
            `<line x1="${x}" y1="${y + size / 2}" x2="${x + size}" y2="${y + size / 2}" stroke="${colors.muted}" stroke-width="1.5"/>`,
          );
        else
          parts.push(
            `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="2" fill="${outcome === 1 ? colors.mark : "none"}" stroke="${colors.mark}" stroke-width="1.5"/>`,
          );
      });
    };
    row(c.base, 105);
    row(c.candidate, 129);
    if (changed.has(c.id)) {
      const y = 150;
      parts.push(
        `<path d="M${x0 + 6} ${y} v6 h${column - 12} v-6" fill="none" stroke="${colors.accent}" stroke-width="2"/>`,
      );
      text(
        x0 + column / 2,
        y + 22,
        labels[i] ?? c.id,
        `font-size="12" font-weight="700" text-anchor="middle" fill="${colors.accent}"`,
      );
    }
  });
  if (changed.size > 0)
    text(
      LEFT,
      196,
      `changed: ${changed.size} of ${input.cases.length} cases`,
      `font-size="12" fill="${colors.muted}"`,
    );
  // The legend: what a square means.
  const legend = (x: number, label: string, mark: string): void => {
    parts.push(mark);
    text(x + 16, 196, label, `font-size="12" fill="${colors.muted}"`);
  };
  const legendX = RIGHT - 250;
  legend(
    legendX,
    "passed",
    `<rect x="${legendX}" y="186" width="11" height="11" rx="2" fill="${colors.mark}" stroke="${colors.mark}" stroke-width="1.5"/>`,
  );
  legend(
    legendX + 80,
    "failed",
    `<rect x="${legendX + 80}" y="186" width="11" height="11" rx="2" fill="none" stroke="${colors.mark}" stroke-width="1.5"/>`,
  );
  if (input.cases.some((c) => [...c.base, ...c.candidate].includes(null)))
    legend(
      legendX + 160,
      "missing",
      `<line x1="${legendX + 160}" y1="191.5" x2="${legendX + 171}" y2="191.5" stroke="${colors.muted}" stroke-width="1.5"/>`,
    );

  // 3. The difference axis, centred at 0, with the margin and the bound.
  const low = Math.floor((Math.min(input.change.bound, -input.margin) - 0.05) * 10) / 10;
  const high = 0.1;
  const scale = (value: number): number => LEFT + ((value - low) / (high - low)) * (RIGHT - LEFT);
  const axisY = 244;
  parts.push(
    `<line x1="${LEFT}" y1="${axisY}" x2="${RIGHT}" y2="${axisY}" stroke="${colors.grid}" stroke-width="1"/>`,
  );
  for (let tick = Math.ceil(low * 10) / 10; tick <= high + 1e-9; tick += 0.1) {
    const x = scale(tick);
    parts.push(
      `<line x1="${x}" y1="${axisY - 4}" x2="${x}" y2="${axisY + 4}" stroke="${colors.grid}"/>`,
    );
    text(x, axisY + 20, points(tick), `font-size="11" text-anchor="middle" fill="${colors.muted}"`);
  }
  text(20, axisY + 4, "change, points", `font-size="13" fill="${colors.muted}"`);
  const zero = scale(0);
  parts.push(
    `<line x1="${zero}" y1="${axisY - 26}" x2="${zero}" y2="${axisY + 4}" stroke="${colors.text}" stroke-width="1.5"/>`,
  );
  text(zero + 4, axisY - 30, "no change", `font-size="11" fill="${colors.muted}"`);
  const margin = scale(-input.margin);
  parts.push(
    `<line x1="${margin}" y1="${axisY - 26}" x2="${margin}" y2="${axisY + 4}" stroke="${colors.text}" stroke-width="1.5" stroke-dasharray="2 2"/>`,
  );
  text(
    margin + 4,
    axisY - 30,
    `margin ${points(-input.margin)}`,
    `font-size="11" fill="${colors.muted}"`,
  );
  const bound = scale(input.change.bound);
  const estimate = scale(input.change.estimate);
  parts.push(
    `<line x1="${bound}" y1="${axisY - 10}" x2="${estimate}" y2="${axisY - 10}" stroke="${colors.accent}" stroke-width="2.5" ${input.change.validated ? "" : 'stroke-dasharray="6 4"'}/>`,
  );
  parts.push(`<circle cx="${estimate}" cy="${axisY - 10}" r="5" fill="${colors.accent}"/>`);
  text(
    estimate + 9,
    axisY - 6,
    points(input.change.estimate),
    `font-size="12" font-weight="700" fill="${colors.accent}"`,
  );
  text(
    bound,
    axisY - 18,
    `${points(input.change.bound)} ${input.change.validated ? "bound" : "descriptive bound, not validated"}`,
    `font-size="11" fill="${colors.muted}"`,
  );

  // 4. The policy, from the card.
  text(20, 304, input.footer, `font-size="13" font-weight="600" fill="${colors.text}"`);

  const alt = heroAlt(input);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title desc" font-family="${FONT}">`,
    `<title id="title">${escape(input.title)}</title>`,
    `<desc id="desc">${escape(alt)}</desc>`,
    `<rect width="${WIDTH}" height="${HEIGHT}" rx="8" fill="${colors.background}"/>`,
    ...parts,
    "</svg>",
    "",
  ].join("\n");
}
