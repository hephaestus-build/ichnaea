import { type DecisionView } from "./view.ts";
/** Renders the CI summary in Markdown (a GitHub job summary or a merge-request note). */
export declare function renderMarkdown(view: DecisionView): string;
/**
 * Renders the static HTML report: one file, no JavaScript, no external resources. Colour never
 * carries meaning alone: every verdict is written out, the badge text keeps the page's text colour,
 * and the verdict colours come from the Okabe–Ito palette, which is safe for the common forms of
 * colour blindness, in light and dark.
 */
export declare function renderHtml(view: DecisionView): string;
/**
 * Problems a rendered output must not have (REQ-129). Returns one message per problem. Run it on
 * a view built with `neutral: true`, so a case named "significant" cannot block a report. Every rate and
 * every difference in a table must stand next to its interval, and an HTML bound marked not
 * validated must say so (decision 0015).
 */
export declare function lintReport(text: string): string[];
//# sourceMappingURL=render.d.ts.map