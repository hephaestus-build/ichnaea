import { canonicalize } from "../contracts/canonical.ts";
import { projectForEgress } from "../contracts/egress.ts";
import { Decision } from "../contracts/records/decision.ts";
import type { RunManifest } from "../contracts/run-manifest.ts";
import type { Run } from "../contracts/records/run.ts";

import { lintReport, renderHtml, renderMarkdown } from "./render.ts";
import { recalculation, runManifest, type Recalculation } from "./manifest.ts";
import { calculateDecision, recompute, type DecisionRecords } from "./recompute.ts";
import { decisionView as buildView, type DecisionView } from "./view.ts";

/** Thrown when the decision cannot be verified or its report breaks the wording rules. */
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

/** A run and its sealed digests, if they were recorded by the deciding engine. */
export interface ReportRecords extends DecisionRecords {
  /** Sealed digests of the input records and the original decision. */
  readonly manifest?: RunManifest;
}

function versionParts(version: string): { release: string[]; pre: string[] } {
  const withoutBuild = version.split("+")[0] ?? "";
  const [release = "", ...pre] = withoutBuild.split("-");
  return { release: release.split("."), pre: pre.join("-").split(".").filter(Boolean) };
}

/** Compare semantic versions, ignoring build metadata. */
function newer(left: string, right: string): boolean {
  const a = versionParts(left);
  const b = versionParts(right);
  for (const [index, id] of a.release.entries()) {
    const unequal = BigInt(id) - BigInt(b.release[index] ?? "0");
    if (unequal !== 0n) return unequal > 0n;
  }
  if (!a.pre.length || !b.pre.length) return a.pre.length < b.pre.length;
  for (const [index, id] of a.pre.entries()) {
    const other = b.pre[index];
    if (other === undefined) return true;
    if (id === other) continue;
    const aNumeric = /^\d+$/.test(id);
    const bNumeric = /^\d+$/.test(other);
    if (aNumeric && bNumeric) return BigInt(id) > BigInt(other);
    if (aNumeric !== bNumeric) return bNumeric;
    return id > other;
  }
  return false;
}

/** Verify the inputs before creating any public view, using the current engine when requested. */
export function verifiedReport(
  records: ReportRecords,
  options: Omit<ReportOptions, "format"> = {},
  engine: string = records.decision.ichnaea,
): { view: DecisionView; neutral: DecisionView; recalculation?: Recalculation } {
  const manifest = records.manifest;
  if (
    manifest &&
    canonicalize(manifest) !== canonicalize(runManifest(records, records.decision, records.aa))
  )
    throw new ReportError("the stored decision does not recompute: run manifest digests differ");
  let decision: Decision;
  let replay: Recalculation | undefined;
  if (manifest && newer(engine, manifest.ichnaea)) {
    decision = calculateDecision(records, engine);
    replay = recalculation(manifest, decision);
  } else {
    const check = recompute(records);
    if (!check.matches)
      throw new ReportError(
        `the stored decision does not recompute from the stored records (${check.differences.join(", ")})`,
      );
    decision = records.decision;
  }
  const projected = Decision.parse(
    projectForEgress(Decision, decision, {
      purpose: "PU-1",
      maxClass: "none",
    }).value,
  );
  const suite = options.suite ?? `run ${decision.run}`;
  const lineage = options.lineage ?? records.run.lineage;
  const build = (neutral: boolean): DecisionView => {
    const view = buildView(projected, suite, lineage, { neutral });
    return replay
      ? {
          ...view,
          lineage: [...view.lineage, ["Recalculation", replay.identity] as const],
        }
      : view;
  };
  return { view: build(false), neutral: build(true), ...(replay ? { recalculation: replay } : {}) };
}

/** Build the public view after replay or digest verification. */
export function decisionView(records: ReportRecords): DecisionView {
  return verifiedReport(records, { suite: records.plan.suite }).view;
}

/** Render a verified decision synchronously, with no file access. */
export function report(records: ReportRecords, options: ReportOptions): string {
  const result = verifiedReport(records, options);
  return renderReport(result, options.format);
}

/** Render one of the outputs from the verified view and its wording check. */
export function renderReport(
  { view, neutral }: Pick<ReturnType<typeof verifiedReport>, "view" | "neutral">,
  format: ReportOptions["format"],
): string {
  if (format === "json") return `${JSON.stringify(view, null, 2)}\n`;
  const render = format === "markdown" ? renderMarkdown : renderHtml;
  const problems = lintReport(render(neutral));
  if (problems.length > 0) throw new ReportError(`the report is not valid: ${problems.join("; ")}`);
  return render(view);
}
