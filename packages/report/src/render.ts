import type { DecisionView } from "./view.ts";

const cell = (text: string | number): string =>
  String(text).replaceAll("|", "\\|").replaceAll("\n", " ");

/** Renders the CI summary in Markdown (a GitHub job summary or a merge-request note). */
export function renderMarkdown(view: DecisionView): string {
  const lines: string[] = [];
  lines.push(`## ${view.title}`, "", `**${view.verdict}**: ${view.reason}`, "", view.scope, "");
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
  const notes = view.measures.flatMap((m) => m.notes.map((n) => `- ${m.measure}: ${n}`));
  if (notes.length > 0) lines.push("", ...notes);
  if (view.gates.length > 0)
    lines.push("", "**Hard gates**", "", ...view.gates.map((g) => `- ${g.gate}: ${g.result}`));
  const negative = view.flips.filter((f) => f.direction === "negative");
  lines.push(
    "",
    `**Flips**: ${negative.length} case(s) went from pass to fail, ${view.flips.length - negative.length} from fail to pass.`,
  );
  if (negative.length > 0) {
    lines.push(
      "",
      "| Measure | Case | Base | Candidate |",
      "|---|---|---|---|",
      ...negative.map(
        (f) => `| ${cell(f.measure)} | ${cell(f.case)} | ${f.base} | ${f.candidate} |`,
      ),
    );
  }
  if (view.power.length > 0) {
    lines.push(
      "",
      "**Power statement**",
      "",
      "| Measure | Cases | Replicates | Zero-noise floor | MDE | Margin | Can decide | Assumption |",
      "|---|---|---|---|---|---|---|---|",
    );
    lines.push(
      ...view.power.map(
        (p) =>
          `| ${cell(p.measure)} | ${p.cases} | ${p.replicates} | ${p.floor} | ${p.mde} | ${p.margin} | ${p.decidable} | ${cell(p.assumption)} |`,
      ),
    );
  }
  lines.push("", `**Missing data**: ${view.missingness}`);
  if (view.differingFactors.length > 0)
    lines.push(
      "",
      `**What differs between the arms**: ${view.differingFactors.map((f) => `\`${f}\``).join(", ")}`,
    );
  lines.push("", "**Limitations**", "", ...view.limitations.map((l) => `- ${l}`));
  lines.push(
    "",
    "<details><summary>Lineage</summary>",
    "",
    ...view.lineage.map(([k, v]) => `- ${k}: \`${v}\``),
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

/**
 * Renders the static HTML report: one file, no JavaScript, no external resources. Colour never
 * carries meaning alone: every verdict is written out, and the palette works in light and dark.
 */
export function renderHtml(view: DecisionView): string {
  const badge = (verdict: string): string =>
    `<span class="badge ${VERDICT_CLASS[verdict] ?? "estimate"}">${escape(verdict)}</span>`;
  const rows = view.measures
    .flatMap((m) =>
      m.arms.map(
        (a, i) =>
          `<tr>${i === 0 ? `<th scope="row" rowspan="${m.arms.length}">${escape(m.measure)}${m.tier === "secondary" ? " <small>(secondary)</small>" : ""}</th><td rowspan="${m.arms.length}">${badge(m.verdict)}</td>` : ""}<td>${escape(a.arm)}</td><td class="num">${escape(a.rate)}</td><td class="num">${escape(a.interval)}</td><td class="num">${escape(a.n)}</td><td class="num">${a.missing}</td>${i === 0 ? `<td class="num" rowspan="${m.arms.length}">${escape(m.difference?.estimate ?? "–")}</td><td class="num" rowspan="${m.arms.length}">${escape(m.difference?.bound ?? "–")}</td><td class="num" rowspan="${m.arms.length}">${escape(m.difference?.margin ?? "–")}</td>` : ""}</tr>`,
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
        `<tr><td>${escape(p.measure)}</td><td class="num">${p.cases}</td><td class="num">${p.replicates}</td><td class="num">${escape(p.floor)}</td><td class="num">${escape(p.mde)}</td><td class="num">${escape(p.margin)}</td><td>${escape(p.decidable)}</td><td>${escape(p.assumption)}</td></tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(view.title)}</title>
<style>
:root { color-scheme: light dark; --fg: #1b1f24; --bg: #ffffff; --muted: #57606a; --line: #d0d7de; --pass: #0b6e4f; --regression: #b3261e; --inconclusive: #8a5a00; --invalid: #6e40c9; --estimate: #3b5b85; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6edf3; --bg: #0d1117; --muted: #9da7b3; --line: #30363d; --pass: #56d4a5; --regression: #ff8b80; --inconclusive: #e3b341; --invalid: #c4a7ff; --estimate: #8fb4e8; } }
body { font: 15px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); max-width: 72rem; margin: 2rem auto; padding: 0 1rem; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; } th, td { border-bottom: 1px solid var(--line); padding: .35rem .5rem; text-align: left; vertical-align: top; }
td.num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.badge { font-weight: 700; border: 2px solid currentColor; border-radius: .3rem; padding: 0 .4rem; }
.pass { color: var(--pass); } .regression { color: var(--regression); } .inconclusive { color: var(--inconclusive); } .invalid { color: var(--invalid); } .estimate { color: var(--estimate); }
.muted, small { color: var(--muted); } code { overflow-wrap: anywhere; }
</style>
</head>
<body>
<h1>${escape(view.title)}</h1>
<p class="verdict">${badge(view.verdict)} ${escape(view.reason)}</p>
<p class="muted">${escape(view.scope)}</p>
<table>
<caption>Primary and secondary measures</caption>
<thead><tr><th scope="col">Measure</th><th scope="col">Verdict</th><th scope="col">Arm</th><th scope="col">Rate</th><th scope="col">95% interval</th><th scope="col">n</th><th scope="col">Missing</th><th scope="col">Difference</th><th scope="col">Bound</th><th scope="col">Margin</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
${view.measures.some((m) => m.notes.length > 0) ? `<h2>Notes</h2>${list(view.measures.flatMap((m) => m.notes.map((n) => `${m.measure}: ${n}`)))}` : ""}
${view.gates.length > 0 ? `<h2>Hard gates</h2>${list(view.gates.map((g) => `${g.gate}: ${g.result}`))}` : ""}
<h2>Flips</h2>
${view.flips.length === 0 ? "<p>No case changed its majority outcome.</p>" : `<table><thead><tr><th scope="col">Measure</th><th scope="col">Case</th><th scope="col">Direction</th><th scope="col">Base</th><th scope="col">Candidate</th></tr></thead><tbody>\n${flipRows}\n</tbody></table>`}
${view.power.length > 0 ? `<h2>Power statement</h2><table><thead><tr><th scope="col">Measure</th><th scope="col">Cases</th><th scope="col">Replicates</th><th scope="col">Zero-noise floor</th><th scope="col">MDE</th><th scope="col">Margin</th><th scope="col">Can decide</th><th scope="col">Assumption</th></tr></thead><tbody>\n${powerRows}\n</tbody></table>` : ""}
<h2>Missing data</h2>
<p>${escape(view.missingness)}</p>
${view.differingFactors.length > 0 ? `<h2>What differs between the arms</h2>${list(view.differingFactors)}` : ""}
<h2>Limitations</h2>
${list(view.limitations)}
<footer><h2>Lineage</h2><dl>${view.lineage.map(([k, v]) => `<dt>${escape(k)}</dt><dd><code>${escape(v)}</code></dd>`).join("")}</dl></footer>
</body>
</html>
`;
}

/** Problems a rendered output must not have (REQ-129). Returns one message per problem. */
export function lintReport(text: string): string[] {
  const problems: string[] = [];
  if (/\bsignifican(t|ce)\b/i.test(text))
    problems.push("the word 'significant' without an effect size and interval");
  if (!/Lineage/.test(text)) problems.push("no lineage footer");
  if (/\banonymi[sz]ed?\b|\banonymous\b/i.test(text)) problems.push("an anonymity claim");
  return problems;
}
