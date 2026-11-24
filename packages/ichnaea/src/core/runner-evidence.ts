import { canonicalize, digest } from "../contracts/canonical.ts";
import { classRank } from "../contracts/data-class.ts";
import type { Configuration } from "../contracts/records/configuration.ts";
import { Trial } from "../contracts/records/trial.ts";
import {
  FAILURE_OUTCOME,
  type ObservedConfiguration,
  type TrialRequest,
  type TrialResult,
} from "../contracts/records/worker.ts";

import { captureStatus } from "../run/capture.ts";

import { NOT_CAPTURED } from "./record-run.ts";

interface EvidenceContext {
  readonly run: string;
  readonly block: number;
  readonly analysisPlan: string;
  readonly configuration: string;
  readonly settings: string;
  readonly expected?: Configuration;
  readonly requireFullObservations?: boolean;
  readonly artifacts?: Trial["evidence"];
  readonly startedAt: string;
  readonly endedAt: string;
  readonly attempts?: Trial["attempts"];
}

function fullMismatch(
  observed: ObservedConfiguration,
  configuration: Configuration,
): string | undefined {
  const model = configuration.models[0];
  if (configuration.models.length !== 1 || observed.model !== model?.id.value)
    return "the observed model differs from the bound model";
  if (
    model.route &&
    observed.route !== model.route.value &&
    observed.route !== digest(model.route.value)
  )
    return "the observed route differs from the bound route";
  const parameters = Object.fromEntries(
    configuration.parameters.map(({ name, value }) => [name, value]),
  );
  if (canonicalize(observed.parameters) !== canonicalize(parameters))
    return "the observed parameters differ from the bound parameters";
  const commit = configuration.factors["code.commit"];
  if (commit && observed.code.commit !== commit.value) return "the observed commit differs";
  const image = configuration.factors["code.image"];
  if (image && observed.code.image !== image.value) return "the observed image differs";
  for (const [name, factor] of Object.entries(configuration.factors)) {
    if (factor.part === "data" && observed.environment[name] !== factor.value)
      return "an observed data factor differs";
  }
  return undefined;
}

/** Converts a correlated worker reply into evidence for the bound trial. */
export function workerEvidence(
  request: TrialRequest,
  result: TrialResult,
  context: EvidenceContext,
): Trial {
  const lowered = classRank(result.dataClass) < classRank(request.dataClass);
  const usage = {
    calls: result.usage.calls,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    wallMs: Math.max(0, Date.parse(context.endedAt) - Date.parse(context.startedAt)),
  };
  const base = {
    schema: "ichnaea.trial/1",
    id: request.trial.id,
    source: "offline",
    run: context.run,
    case: request.case.id,
    caseDigest: request.case.digest,
    unit: request.case.unit,
    configuration: context.configuration,
    arm: request.trial.arm,
    replicate: request.trial.replicate,
    analysisPlan: context.analysisPlan,
    block: context.block,
    startedAt: context.startedAt,
    endedAt: context.endedAt,
    context: result.context,
    attempts: context.attempts,
    dataClass: lowered ? request.dataClass : result.dataClass,
    usage,
  };
  const failed = (outcome: Trial["outcome"], kind: string, message?: string): Trial =>
    Trial.parse({
      ...base,
      outcome,
      error: { kind, ...(message === undefined ? {} : { message }) },
    });
  if (request.limits.calls !== undefined && usage.calls > request.limits.calls)
    return failed("budget_exceeded", "trial-call-cap");
  if (lowered) return failed("protocol_failure", "lowered-data-class");
  const { failure, observed } = result;
  if (failure) {
    if (
      result.output !== undefined ||
      result.pointer !== undefined ||
      result.artifacts?.length ||
      result.truncated !== undefined
    )
      return failed("protocol_failure", "failure-with-output");
    if (failure.class !== "system") return failed(FAILURE_OUTCOME[failure.class], failure.kind);
  }
  if ("kind" in observed && observed.kind === "unavailable")
    return failed("protocol_failure", "missing-observations");
  if (observed.configuration !== context.settings)
    return failed(
      "invalid_configuration",
      "configuration-mismatch",
      "the worker read different settings",
    );
  if ("kind" in observed && context.requireFullObservations)
    return failed("invalid_configuration", "missing-observations");
  if (!("kind" in observed) && context.expected) {
    const mismatch = fullMismatch(observed, context.expected);
    if (mismatch) return failed("invalid_configuration", "configuration-mismatch", mismatch);
  }
  if (failure) return failed(FAILURE_OUTCOME[failure.class], failure.kind);
  if (
    captureStatus(result) !== "present" ||
    (result.output === undefined && result.pointer === undefined && !context.artifacts?.length)
  )
    return failed("infrastructure_failure", NOT_CAPTURED);
  return Trial.parse({
    ...base,
    outcome: "completed",
    output: result.output,
    pointer: result.pointer,
    evidence: context.artifacts,
    observed: [
      { name: "configuration-file", value: observed.configuration },
      ...("kind" in observed
        ? []
        : [
            { name: "model", value: observed.model },
            { name: "route", value: observed.route },
            { name: "parameters", value: observed.parameters },
            { name: "configuration-read", value: observed.configurationRead },
            { name: "environment", value: observed.environment },
          ]),
    ],
    joinKeys: Object.fromEntries(
      result.usage.responseIds.map((id, index) => [`responseId.${index}`, id]),
    ),
  });
}
