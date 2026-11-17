import { lintReport, renderHtml, renderMarkdown } from "./render.js";
import { decisionView } from "./view.js";
/** Thrown when a rendered report would break the wording rules (REQ-129). */
export class ReportError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    name = "ReportError";
}
/**
 * Renders a decision as text. It is synchronous, writes no file and computes nothing: every number
 * comes from the decision record (REQ-82, REQ-128). The Markdown and the HTML pass the report lint
 * first, so a report never shows an estimate without its interval or an unlabelled unvalidated
 * bound; one that would throws a ReportError. Writing the text is the caller's job.
 */
export function report(decision, options) {
    const suite = options.suite ?? `run ${decision.run}`;
    const view = decisionView(decision, suite, options.lineage);
    if (options.format === "json")
        return `${JSON.stringify(view, null, 2)}\n`;
    const render = options.format === "markdown" ? renderMarkdown : renderHtml;
    const neutral = decisionView(decision, suite, options.lineage, { neutral: true });
    const problems = lintReport(render(neutral));
    if (problems.length > 0)
        throw new ReportError(`the report is not valid: ${problems.join("; ")}`);
    return render(view);
}
//# sourceMappingURL=report.js.map