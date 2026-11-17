import type { Decision, Run } from "../contracts/index.ts";

import { lintReport, renderHtml, renderMarkdown } from "./render.ts";
import { decisionView } from "./view.ts";

/** Thrown when a rendered report would break the wording rules (REQ-129). */
export class ReportError extends Error {
  /** The error's name, for `instanceof`-free checks. */
  override readonly name = "ReportError";
}

/** What `report` renders. */
export interface ReportOptions {
  /** `markdown` for a summary, `html` for a page, `json` for the view model that both render. */
  readonly format: "markdown" | "html" | "json";
  /** The suite's name in the title. Default: the run, as `run <id>`. */
  readonly suite?: string;
  /** The run's lineage, shown in the footer. Default: none beyond the decision's own. */
  readonly lineage?: Run["lineage"];
}

/**
 * Renders a decision as text. It is synchronous, writes no file and computes nothing: every number
 * comes from the decision record (REQ-82, REQ-128). The Markdown and the HTML pass the report lint
 * first, so a report never shows an estimate without its interval or an unlabelled unvalidated
 * bound; one that would throws a ReportError. Writing the text is the caller's job.
 */
export function report(decision: Decision, options: ReportOptions): string {
  const suite = options.suite ?? `run ${decision.run}`;
  const view = decisionView(decision, suite, options.lineage);
  if (options.format === "json") return `${JSON.stringify(view, null, 2)}\n`;
  const render = options.format === "markdown" ? renderMarkdown : renderHtml;
  const neutral = decisionView(decision, suite, options.lineage, { neutral: true });
  const problems = lintReport(render(neutral));
  if (problems.length > 0) throw new ReportError(`the report is not valid: ${problems.join("; ")}`);
  return render(view);
}
