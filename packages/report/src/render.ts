import type { DecisionView } from "./view.ts";

/**
 * Escapes text for Markdown: every string in a summary may come from a configuration or a case,
 * which the author of a change controls, so none may add a heading, a link, an image or HTML.
 */
const md = (text: string | number): string =>
  String(text)
    .replaceAll(/\s+/g, " ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(/[\\`*_[\]{}()#+!|~]/g, (c) => `\\${c}`);
const cell = md;

/** Renders the CI summary in Markdown (a GitHub job summary or a merge-request note). */
export function renderMarkdown(view: DecisionView): string {
  const lines: string[] = [];
  lines.push(
    `## ${md(view.title)}`,
    "",
    `**${view.verdict}** ${md(view.claim)}: ${md(view.reason)}`,
    "",
    md(view.method),
    "",
  );
  lines.push(
    "| Measure | Verdict | Arm | Rate | 95% interval | n | Missing | Difference | Bound | Margin |",
    "|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const m of view.measures) {
    m.arms.forEach((a, i) => {
      const first = i === 0;
      lines.push(
        `| ${first ? cell(`${m.measure}${m.tier === "secondary" ? " (secondary)" : ""}`) : ""} | ${first ? m.verdict : ""} | ${cell(a.arm)} | ${a.rate} | ${a.interval} | ${a.n} | ${a.missing} | ${first && m.difference ? m.difference.estimate : ""} | ${first && m.difference ? m.difference.bound : ""} | ${first && m.difference ? m.difference.margin : ""} |`,
      );
    });
  }
  const notes = view.measures.flatMap((m) => m.notes.map((n) => `- ${md(m.measure)}: ${md(n)}`));
  if (notes.length > 0) lines.push("", ...notes);
  if (view.gates.length > 0)
    lines.push(
      "",
      "**Hard gates**",
      "",
      ...view.gates.map((g) => `- ${md(g.gate)}: ${md(g.result)}`),
    );
  const negative = view.flips.filter((f) => f.direction === "negative");
  lines.push(
    "",
    `**Flips**: ${negative.length} case(s) went from pass to fail, ${view.flips.length - negative.length} from fail to pass.`,
  );
  if (view.flips.length > 0) {
    lines.push(
      "",
      "| Measure | Case | Direction | Base | Candidate |",
      "|---|---|---|---|---|",
      ...view.flips.map(
        (f) =>
          `| ${cell(f.measure)} | ${cell(f.case)} | ${f.direction} | ${f.base} | ${f.candidate} |`,
      ),
    );
  }
  if (view.power.length > 0) {
    lines.push(
      "",
      "**Power statement**",
      "",
      "| Statement | Measure | Cases | Replicates | Zero-noise floor | MDE | Margin | Margin within reach | Assumption |",
      "|---|---|---|---|---|---|---|---|---|",
    );
    lines.push(
      ...view.power.map(
        (p) =>
          `| ${p.statement} | ${cell(p.measure)} | ${p.cases} | ${p.replicates} | ${p.floor} | ${p.mde} | ${p.margin} | ${p.reach} | ${cell(p.assumption)} |`,
      ),
    );
  }
  lines.push("", `**Missing data**: ${md(view.missingness)}`);
  if (view.sensitivity.length > 0)
    lines.push(
      "",
      "| Measure | Imputation | Difference | Bound | Verdict | Changes the verdict |",
      "|---|---|---|---|---|---|",
      ...view.sensitivity.map(
        (s) =>
          `| ${cell(s.measure)} | ${md(s.imputation)} | ${s.difference} | ${s.bound} | ${s.verdict} | ${s.changes} |`,
      ),
    );
  if (view.differingFactors.length > 0)
    lines.push(
      "",
      `**What differs between the arms**: ${view.differingFactors.map(md).join(", ")}`,
    );
  lines.push("", "**Limitations**", "", ...view.limitations.map((l) => `- ${md(l)}`));
  lines.push(
    "",
    "<details><summary>Lineage</summary>",
    "",
    ...view.lineage.map(([k, v]) => `- ${md(k)}: ${md(v)}`),
    "",
    "</details>",
    "",
  );
  return lines.join("\n");
}

const escape = (text: string | number): string =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const VERDICT_CLASS: Readonly<Record<string, string>> = {
  PASS: "pass",
  "NON-INFERIOR": "pass",
  REGRESSION: "regression",
  INCONCLUSIVE: "inconclusive",
  INVALID: "invalid",
  "ESTIMATE-ONLY": "estimate",
};

/** Percentage points with a true minus sign, for the text alternative. */
const signedPoints = (v: number): string =>
  `${v < 0 ? "−" : v > 0 ? "+" : ""}${Math.abs(v * 100).toFixed(1)}`;

/**
 * The difference of one measure on an axis centred at 0 with the margin drawn (REQ-129): the
 * one-sided interval as a bar from the lower bound, the estimate as a mark, and a text alternative
 * that states the same numbers.
 */
function axisFigure(
  measure: string,
  axis: { estimate: number; lower: number; margin: number },
): string {
  const reach = Math.max(Math.abs(axis.lower), Math.abs(axis.estimate), axis.margin, 0.05) * 1.25;
  const width = 480;
  const x = (v: number): number => Math.round(((v + reach) / (2 * reach)) * width * 10) / 10;
  const text = `${measure}: difference ${signedPoints(axis.estimate)} points, one-sided lower bound ${signedPoints(axis.lower)}, margin −${(axis.margin * 100).toFixed(1)} points. Non-inferiority needs the bound to the right of the margin.`;
  return `<figure><svg viewBox="0 0 ${width} 60" width="100%" role="img" aria-label="${escape(text)}"><title>${escape(text)}</title>
<line x1="0" y1="30" x2="${width}" y2="30" class="axis"/>
<line x1="${x(0)}" y1="12" x2="${x(0)}" y2="48" class="zero"/>
<line x1="${x(-axis.margin)}" y1="8" x2="${x(-axis.margin)}" y2="52" class="margin"/>
<line x1="${x(axis.lower)}" y1="30" x2="${width}" y2="30" class="interval"/>
<circle cx="${x(axis.estimate)}" cy="30" r="5" class="estimate"/>
<text x="${x(0)}" y="10" text-anchor="middle">0</text><text x="${x(-axis.margin)}" y="60" text-anchor="middle">−margin</text>
</svg><figcaption>${escape(text)}</figcaption></figure>`;
}

/** A numeric table cell. `col` names what it holds, so the lint can check each row. */
const num = (col: string, value: string | number, rowspan?: number): string =>
  `<td class="num" data-col="${col}"${rowspan === undefined ? "" : ` rowspan="${rowspan}"`}>${escape(value)}</td>`;

/**
 * Renders the static HTML report: one file, no JavaScript, no external resources. Colour never
 * carries meaning alone: every verdict is written out, the badge text keeps the page's text colour,
 * and the verdict colours come from the Okabe–Ito palette, which is safe for the common forms of
 * colour blindness, in light and dark.
 */
export function renderHtml(view: DecisionView): string {
  const badge = (verdict: string): string =>
    `<span class="badge ${VERDICT_CLASS[verdict] ?? "estimate"}">${escape(verdict)}</span>`;
  const rows = view.measures
    .flatMap((m) =>
      m.arms.map(
        (a, i) =>
          `<tr>${i === 0 ? `<th scope="row" rowspan="${m.arms.length}">${escape(m.measure)}${m.tier === "secondary" ? " <small>(secondary)</small>" : ""}</th><td rowspan="${m.arms.length}">${badge(m.verdict)}</td>` : ""}<td>${escape(a.arm)}</td>${num("rate", a.rate)}${num("interval", a.interval)}${num("n", a.n)}${num("missing", a.missing)}${i === 0 ? `${num("difference", m.difference?.estimate ?? "–", m.arms.length)}${num("bound", m.difference?.bound ?? "–", m.arms.length)}${num("margin", m.difference?.margin ?? "–", m.arms.length)}` : ""}</tr>`,
      ),
    )
    .join("\n");
  const list = (items: readonly string[]): string =>
    `<ul>${items.map((i) => `<li>${escape(i)}</li>`).join("")}</ul>`;
  const flipRows = view.flips
    .map(
      (f) =>
        `<tr><td>${escape(f.measure)}</td><td>${escape(f.case)}</td><td>${escape(f.direction)}</td><td class="num">${escape(f.base)}</td><td class="num">${escape(f.candidate)}</td></tr>`,
    )
    .join("\n");
  const powerRows = view.power
    .map(
      (p) =>
        `<tr><td>${escape(p.statement)}</td><td>${escape(p.measure)}</td><td class="num">${p.cases}</td><td class="num">${p.replicates}</td><td class="num">${escape(p.floor)}</td><td class="num">${escape(p.mde)}</td><td class="num">${escape(p.margin)}</td><td>${escape(p.reach)}</td><td>${escape(p.assumption)}</td></tr>`,
    )
    .join("\n");
  const sensitivityRows = view.sensitivity
    .map(
      (s) =>
        `<tr><td>${escape(s.measure)}</td><td>${escape(s.imputation)}</td>${num("difference", s.difference)}${num("bound", s.bound)}<td>${badge(s.verdict)}</td><td>${escape(s.changes)}</td></tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(view.title)}</title>
<style>
:root { color-scheme: light dark; --fg: #1b1f24; --bg: #ffffff; --muted: #57606a; --line: #d0d7de; --pass: #0072b2; --regression: #d55e00; --inconclusive: #e69f00; --invalid: #cc79a7; --estimate: #56b4e9; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6edf3; --bg: #0d1117; --muted: #9da7b3; --line: #30363d; } }
body { font: 15px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); max-width: 72rem; margin: 2rem auto; padding: 0 1rem; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; } th, td { border-bottom: 1px solid var(--line); padding: .35rem .5rem; text-align: left; vertical-align: top; }
td.num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.badge { font-weight: 700; border: 2px solid; border-left-width: .5rem; border-radius: .3rem; padding: 0 .4rem; }
.pass { border-color: var(--pass); } .regression { border-color: var(--regression); } .inconclusive { border-color: var(--inconclusive); } .invalid { border-color: var(--invalid); } .estimate { border-color: var(--estimate); }
.muted, small { color: var(--muted); } code { overflow-wrap: anywhere; }
figure { margin: .5rem 0 1rem; } svg text { fill: var(--muted); font-size: 10px; } .axis { stroke: var(--line); } .zero { stroke: var(--fg); } .margin { stroke: var(--regression); stroke-dasharray: 4 3; } .interval { stroke: var(--pass); stroke-width: 6; } .estimate { fill: var(--fg); }
</style>
</head>
<body>
<h1>${escape(view.title)}</h1>
<p class="verdict">${badge(view.verdict)} <strong>${escape(view.claim)}</strong>: ${escape(view.reason)}</p>
<p class="muted">${escape(view.method)}</p>
<table>
<caption>Primary and secondary measures</caption>
<thead><tr><th scope="col">Measure</th><th scope="col">Verdict</th><th scope="col">Arm</th><th scope="col">Rate</th><th scope="col">95% interval</th><th scope="col">n</th><th scope="col">Missing</th><th scope="col">Difference</th><th scope="col">Bound</th><th scope="col">Margin</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
${view.measures.some((m) => m.difference?.axis) ? `<h2>Differences</h2>${view.measures.flatMap((m) => (m.difference?.axis ? [axisFigure(m.measure, m.difference.axis)] : [])).join("\n")}` : ""}
${view.measures.some((m) => m.notes.length > 0) ? `<h2>Notes</h2>${list(view.measures.flatMap((m) => m.notes.map((n) => `${m.measure}: ${n}`)))}` : ""}
${view.gates.length > 0 ? `<h2>Hard gates</h2>${list(view.gates.map((g) => `${g.gate}: ${g.result}`))}` : ""}
<h2>Flips</h2>
${view.flips.length === 0 ? "<p>No case changed its majority outcome.</p>" : `<table><thead><tr><th scope="col">Measure</th><th scope="col">Case</th><th scope="col">Direction</th><th scope="col">Base</th><th scope="col">Candidate</th></tr></thead><tbody>\n${flipRows}\n</tbody></table>`}
${view.power.length > 0 ? `<h2>Power statement</h2><table><thead><tr><th scope="col">Statement</th><th scope="col">Measure</th><th scope="col">Cases</th><th scope="col">Replicates</th><th scope="col">Zero-noise floor</th><th scope="col">MDE</th><th scope="col">Margin</th><th scope="col">Margin within reach</th><th scope="col">Assumption</th></tr></thead><tbody>\n${powerRows}\n</tbody></table>` : ""}
<h2>Missing data</h2>
<p>${escape(view.missingness)}</p>
${view.sensitivity.length > 0 ? `<table><caption>Sensitivity analysis</caption><thead><tr><th scope="col">Measure</th><th scope="col">Imputation</th><th scope="col">Difference</th><th scope="col">Bound</th><th scope="col">Verdict</th><th scope="col">Changes the verdict</th></tr></thead><tbody>\n${sensitivityRows}\n</tbody></table>` : ""}
${view.differingFactors.length > 0 ? `<h2>What differs between the arms</h2>${list(view.differingFactors)}` : ""}
<h2>Limitations</h2>
${list(view.limitations)}
<footer><h2>Lineage</h2><dl>${view.lineage.map(([k, v]) => `<dt>${escape(k)}</dt><dd><code>${escape(v)}</code></dd>`).join("")}</dl></footer>
</body>
</html>
`;
}

/**
 * The view with every identifier that comes from records (measure, case, arm, gate and factor
 * names, lineage values) replaced, so the wording lint judges only what Ichnaea writes.
 */
export function neutralView(view: DecisionView): DecisionView {
  const ids = [
    ...view.measures.flatMap((m) => [m.measure, ...m.arms.map((a) => a.arm)]),
    ...view.flips.map((f) => f.case),
    ...view.gates.map((g) => g.gate),
    ...view.differingFactors,
    ...view.lineage.flatMap(([k, v]) => [k, v]),
    view.title,
  ]
    .filter((id) => id.length > 0)
    .toSorted((a, b) => b.length - a.length);
  const neutral = (value: unknown): unknown => {
    if (typeof value === "string") return ids.reduce((t, id) => t.replaceAll(id, "id"), value);
    if (Array.isArray(value)) return value.map(neutral);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, neutral(v)]));
    return value;
  };
  return neutral(view) as DecisionView;
}

/** A shown rate, a difference in points, and the cells that state their intervals. */
const RATE = /^\d+\.\d%$/;
const DIFFERENCE = /^[+−]?\d+\.\d pts$/;
const INTERVAL = /^\d+\.\d% to \d+\.\d%$/;
const BOUND = /^≥ [+−]?\d+\.\d pts$/;

/** The problem of one table row whose estimates lack their intervals, if any. */
function rowProblem(cells: ReadonlyMap<string, string>): string | undefined {
  const rate = cells.get("rate");
  const difference = cells.get("difference");
  if (rate !== undefined && RATE.test(rate) && !INTERVAL.test(cells.get("interval") ?? ""))
    return `a rate (${rate}) without its interval`;
  if (
    difference !== undefined &&
    DIFFERENCE.test(difference) &&
    !BOUND.test(cells.get("bound") ?? "")
  )
    return `a difference (${difference}) without its bound`;
  return undefined;
}

/** The cells of one Markdown table row; an escaped pipe stays inside its cell. */
function cellsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
}

/** Markdown table rows as maps from column to cell, by the header row of each table. */
function markdownRows(text: string): Array<Map<string, string>> {
  const rows: Array<Map<string, string>> = [];
  let header: string[] | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) {
      header = undefined;
      continue;
    }
    if (/^\|[-| :]+\|$/.test(line.trim())) continue;
    const cells = cellsOf(line);
    if (!header) {
      header = cells.map((h) =>
        /interval/i.test(h) ? "interval" : h.toLowerCase().replace(/\s+/g, " "),
      );
      continue;
    }
    rows.push(new Map(cells.map((c, i) => [header?.[i] ?? String(i), c])));
  }
  return rows;
}

/** HTML table rows as maps from the `data-col` of each numeric cell to its text. */
function htmlRows(text: string): Array<Map<string, string>> {
  return [...text.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(
    (row) =>
      new Map(
        [...(row[1] ?? "").matchAll(/data-col="([a-z]+)"[^>]*>([^<]*)</g)].map((m) => [
          m[1] ?? "",
          (m[2] ?? "").replaceAll("&amp;", "&").replaceAll("&gt;", ">").replaceAll("&lt;", "<"),
        ]),
      ),
  );
}

/**
 * Problems a rendered output must not have (REQ-129). Returns one message per problem. Run it on
 * the output of `neutralView`, so a case named "significant" cannot block a report. Every rate and
 * every difference in a table must stand next to its interval.
 */
export function lintReport(text: string): string[] {
  const problems: string[] = [];
  if (/\bsignifican(t|ce)\b/i.test(text))
    problems.push("the word 'significant' without an effect size and interval");
  if (!/Lineage/.test(text)) problems.push("no lineage footer");
  if (/\banonymi[sz]ed?\b|\banonymous\b/i.test(text)) problems.push("an anonymity claim");
  for (const row of [...markdownRows(text), ...htmlRows(text)]) {
    const problem = rowProblem(row);
    if (problem) problems.push(`an estimate without its interval: ${problem}`);
  }
  return problems;
}
