import { summarizeRatings } from "../calibration/ratings-agreement.js";
import { seedOf } from "../decide/decide.js";
import { canonicalize } from "../contracts/canonical.js";
import { projectForEgress } from "../contracts/egress.js";
import { Decision } from "../contracts/records/decision.js";
import { lintReport, renderHtml, renderMarkdown } from "./render.js";
import { recalculation, runManifest } from "./manifest.js";
import { calculateDecision, recompute } from "./recompute.js";
import { decisionView as buildView } from "./view.js";
/** Thrown when the decision cannot be verified or its report breaks the wording rules. */
export class ReportError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    name = "ReportError";
}
function versionParts(version) {
    const withoutBuild = version.split("+")[0] ?? "";
    const [release = "", ...pre] = withoutBuild.split("-");
    return { release: release.split("."), pre: pre.join("-").split(".").filter(Boolean) };
}
/** Compare semantic versions, ignoring build metadata. */
function newer(left, right) {
    const a = versionParts(left);
    const b = versionParts(right);
    for (const [index, id] of a.release.entries()) {
        const unequal = BigInt(id) - BigInt(b.release[index] ?? "0");
        if (unequal !== 0n)
            return unequal > 0n;
    }
    if (!a.pre.length || !b.pre.length)
        return a.pre.length < b.pre.length;
    for (const [index, id] of a.pre.entries()) {
        const other = b.pre[index];
        if (other === undefined)
            return true;
        if (id === other)
            continue;
        const aNumeric = /^\d+$/.test(id);
        const bNumeric = /^\d+$/.test(other);
        if (aNumeric && bNumeric)
            return BigInt(id) > BigInt(other);
        if (aNumeric !== bNumeric)
            return bNumeric;
        return id > other;
    }
    return false;
}
/** Verify the inputs before creating any public view, using the current engine when requested. */
export function verifiedReport(records, options = {}, engine = records.decision.ichnaea) {
    const manifest = records.manifest;
    if (manifest &&
        canonicalize(manifest) !== canonicalize(runManifest(records, records.decision, records.aa)))
        throw new ReportError("the stored decision does not recompute: run manifest digests differ");
    let decision;
    let replay;
    if (manifest && newer(engine, manifest.ichnaea)) {
        decision = calculateDecision(records, engine);
        replay = recalculation(manifest, decision);
    }
    else {
        const check = recompute(records);
        if (!check.matches)
            throw new ReportError(`the stored decision does not recompute from the stored records (${check.differences.join(", ")})`);
        decision = records.decision;
    }
    const projected = Decision.parse(projectForEgress(Decision, decision, {
        purpose: "PU-1",
        maxClass: "none",
    }).value);
    const suite = options.suite ?? `run ${decision.run}`;
    const lineage = options.lineage ?? records.run.lineage;
    const agreement = options.ratings && summarizeRatings(options.ratings, seedOf(records.plan));
    const build = (neutral) => {
        const view = {
            ...buildView(projected, suite, lineage, { neutral }),
            ...(agreement
                ? {
                    agreement: {
                        ...agreement,
                        ...(options.ratingsSource ? { source: options.ratingsSource } : {}),
                    },
                }
                : {}),
        };
        return replay
            ? {
                ...view,
                lineage: [...view.lineage, ["Recalculation", replay.identity]],
            }
            : view;
    };
    return { view: build(false), neutral: build(true), ...(replay ? { recalculation: replay } : {}) };
}
/** Build the public view after replay or digest verification. */
export function decisionView(records) {
    return verifiedReport(records, { suite: records.plan.suite }).view;
}
/** Render a verified decision synchronously, with no file access. */
export function report(records, options) {
    const result = verifiedReport(records, options);
    return renderReport(result, options.format);
}
/** Render one of the outputs from the verified view and its wording check. */
export function renderReport({ view, neutral }, format) {
    if (format === "json")
        return `${JSON.stringify(view, null, 2)}\n`;
    const render = format === "markdown" ? renderMarkdown : renderHtml;
    const problems = lintReport(render(neutral));
    if (problems.length > 0)
        throw new ReportError(`the report is not valid: ${problems.join("; ")}`);
    return render(view);
}
//# sourceMappingURL=report.js.map