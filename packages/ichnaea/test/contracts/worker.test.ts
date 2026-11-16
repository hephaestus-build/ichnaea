// REQ-22, REQ-25: the worker protocol's records. A request never tells the system which side it is
// on, and a malformed request is the harness's fault, never a failure of the system.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  Cancel,
  contractFor,
  readRecord,
  TrialFailure,
  TrialRequest,
  TrialResult,
  WorkerError,
  WorkerEvent,
  WorkerReady,
} from "../../src/contracts/index.ts";

const fixture = (kind: string, name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "..", "fixtures", kind, name), "utf8"),
  ) as Record<string, unknown>;

/** The data policy of the member at a path in a record's published writer schema. */
const policyAt = (name: string, path: readonly string[]): unknown =>
  path.reduce<Record<string, unknown>>(
    (node, key) => node[key] as Record<string, unknown>,
    JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "..", "schemas", `${name}.schema.json`), "utf8"),
    ) as Record<string, unknown>,
  )["x-ichnaea-data"];

describe("the worker protocol", () => {
  it("has four failure classes, and a malformed request is a protocol failure", () => {
    expect(TrialFailure.shape.class.options).toEqual([
      "infrastructure",
      "system",
      "not_run",
      "protocol",
    ]);
    const bad = TrialResult.parse(fixture("valid-extra", "trialResult/bad-request.json"));
    expect(bad.failure).toEqual({ class: "protocol", kind: "bad-request" });
  });

  it("does not tell the worker whether its arm is the base or the candidate", () => {
    const request = fixture("valid", "trialRequest.json");
    expect(Object.keys(request)).not.toContain("arm");
    expect(JSON.stringify(request)).not.toMatch(/"role"|"base"/);
    // The arm's name, and the trial ID that holds it, never say which side the arm is: not in the
    // request, and not in the result that echoes its identity.
    const others = ["trialResult", "workerEvent", "cancel"].map((n) =>
      fixture("valid", `${n}.json`),
    );
    for (const record of [request, ...others]) {
      const trial = record["trial"] as { id: string; arm: string };
      expect(trial.arm).not.toMatch(/candidate|base/i);
      expect(trial.id).not.toMatch(/candidate|base/i);
    }
    // A writer is refused a role, and the arm's name stays an opaque part of the identity.
    expect(
      TrialRequest.safeParse({ ...request, arm: { name: "candidate", role: "candidate" } }).success,
    ).toBe(false);
  });

  it("answers a request line it cannot read with a worker error that names no trial", () => {
    expect(
      WorkerError.safeParse({
        schema: "ichnaea.workerError/1",
        dataClass: "none",
        kind: "bad-json",
      }).success,
    ).toBe(true);
    // A guessed identity would attach the error to the wrong trial, so a writer refuses one.
    const guessed = {
      ...fixture("valid", "workerError.json"),
      trial: fixture("valid", "trialResult.json")["trial"],
    };
    expect(WorkerError.safeParse(guessed).success).toBe(false);
  });

  it("carries no content in a worker error, so the worker never guesses a data class", () => {
    const valid = fixture("valid", "workerError.json");
    // A worker that cannot read a line cannot know its class, so the record is always class none.
    expect(WorkerError.safeParse({ ...valid, dataClass: "personal" }).success).toBe(false);
    // The message is classed none in the published schema, so it can never carry the line's content.
    const schema = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "..", "..", "schemas", "workerError.schema.json"),
        "utf8",
      ),
    ) as { properties: { message: { "x-ichnaea-data": { class: string } } } };
    expect(schema.properties.message["x-ichnaea-data"].class).toBe("none");
  });

  it("still needs the request's identity on a protocol failure", () => {
    const anonymous = fixture("valid-extra", "trialResult/bad-request.json");
    delete anonymous["trial"];
    expect(TrialResult.safeParse(anonymous).success).toBe(false);
  });

  it("refuses a short commit next to an image in the writer and the reader alike", () => {
    const result = fixture("valid", "trialResult.json");
    const withCode = (code: Record<string, unknown>): Record<string, unknown> => ({
      ...result,
      observed: { ...(result["observed"] as Record<string, unknown>), code },
    });
    const contract = contractFor("ichnaea.trialResult/1")!;
    const image = `sha256:${"b2".repeat(32)}`;
    const short = withCode({ image, commit: "abc" });
    expect(TrialResult.safeParse(short).success).toBe(false);
    expect(readRecord(contract, short).ok).toBe(false);
    const full = withCode({ image, commit: "0123456789abcdef0123456789abcdef01234567" });
    expect(TrialResult.safeParse(full).success).toBe(true);
    expect(readRecord(contract, full).ok).toBe(true);
  });

  it("gives every request its deadline, its working directory and its configuration file", () => {
    const request = fixture("valid", "trialRequest.json");
    expect(TrialRequest.safeParse(request).success).toBe(true);
    for (const member of ["deadline", "workdir", "configuration"]) {
      const without = structuredClone(request);
      delete without[member];
      expect(TrialRequest.safeParse(without).success, member).toBe(false);
    }
  });

  it("states a deadline as a positive number of seconds, so every language reads it alike", () => {
    const request = fixture("valid", "trialRequest.json");
    const withDeadline = (deadline: string): boolean =>
      TrialRequest.safeParse({ ...request, deadline }).success;
    expect(withDeadline("PT120S")).toBe(true);
    expect(withDeadline("PT0.5S")).toBe(true);
    // A zero limit cancels every trial at once, and minutes or days need a calendar to read.
    for (const refused of ["PT0S", "PT0.0S", "PT2M", "P1D", "120", "PT-1S", "PT01S"])
      expect(withDeadline(refused), refused).toBe(false);
  });

  it("passes a trace context, and a seed and a replayed input only when the suite needs them", () => {
    const traced = TrialRequest.parse(fixture("valid-extra", "trialRequest/traced-replay.json"));
    expect(traced.trace?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
    expect(traced.replay?.stage).toBe("search");
    expect(traced.seed?.algorithm).toBe("mt19937");
    const request = fixture("valid", "trialRequest.json");
    for (const traceparent of [
      "00-abc-def-01",
      "00-" + "A".repeat(32) + "-" + "1".repeat(16) + "-01",
    ])
      expect(TrialRequest.safeParse({ ...request, trace: { traceparent } }).success).toBe(false);
  });

  it("reports raw stage events, and never a stage status of the system's own", () => {
    const result = TrialResult.parse(fixture("valid", "trialResult.json"));
    expect(result.events?.map((e) => [e.stage, e.ran])).toEqual([
      ["search", true],
      ["answer", true],
    ]);
    const withStatus = fixture("valid", "trialResult.json");
    (withStatus["events"] as Array<Record<string, unknown>>)[0]!["status"] = "ok";
    expect(TrialResult.safeParse(withStatus).success).toBe(false);
    expect(readRecord(contractFor("ichnaea.trialResult/1")!, withStatus).ok).toBe(true);
  });

  it("keeps the system's raw stop reason apart from a failure class", () => {
    const result = TrialResult.parse(fixture("valid", "trialResult.json"));
    expect(result.stop).toEqual({ reason: "end_turn" });
    expect(result.failure).toBeUndefined();
    // The stop reason is the system's words; the base maps it to a class, so none is sent.
    const classed = {
      ...fixture("valid", "trialResult.json"),
      stop: { reason: "x", class: "system" },
    };
    expect(TrialResult.safeParse(classed).success).toBe(false);
  });

  it("delivers artifacts by path and media type, with only their class to declare", () => {
    const result = TrialResult.parse(fixture("valid-extra", "trialResult/artifacts-only.json"));
    expect(result.output).toBeUndefined();
    expect(result.artifacts?.[0]).toMatchObject({ name: "exercise", mediaType: "inode/directory" });
    const unhashed = fixture("valid-extra", "trialResult/artifacts-only.json");
    (unhashed["artifacts"] as Array<Record<string, unknown>>)[0]!["digest"] =
      `sha256:${"a".repeat(64)}`;
    // Ichnaea hashes every artifact itself, so a writer never sends a digest of its own.
    expect(TrialResult.safeParse(unhashed).success).toBe(false);
  });

  it("counts the trial's calls once, in its usage, with every response ID", () => {
    const result = TrialResult.parse(fixture("valid", "trialResult.json"));
    expect(result.usage.calls).toBe(3);
    expect(result.usage.responseIds).toHaveLength(3);
    // The usage is the one home of the count, so the run's budget always has it.
    const withoutUsage = fixture("valid", "trialResult.json");
    delete withoutUsage["usage"];
    expect(TrialResult.safeParse(withoutUsage).success).toBe(false);
    expect(TrialResult.safeParse({ ...result, calls: 3 }).success).toBe(false);
    const usage = result.usage as Record<string, unknown>;
    for (const member of ["calls", "responseIds"]) {
      const without = { ...usage };
      delete without[member];
      expect(TrialResult.safeParse({ ...result, usage: without }).success, member).toBe(false);
    }
    // The provider's cost is shown only: a comparison prices the calls from its pinned table.
    expect(TrialResult.safeParse({ ...result, usage: { ...usage, priced: true } }).success).toBe(
      false,
    );
  });

  it("marks an output that the worker knows it truncated", () => {
    const result = TrialResult.parse(fixture("valid-extra", "trialResult/truncated.json"));
    expect(result.truncated).toBe(true);
    const record = fixture("valid", "trialResult.json");
    expect(TrialResult.safeParse({ ...record, truncated: "yes" }).success).toBe(false);
  });

  it("reports what the process read: the configuration's digest, its keys and the factors", () => {
    const result = fixture("valid", "trialResult.json");
    const observed = result["observed"] as Record<string, unknown>;
    expect(observed["configurationRead"]).toEqual(["answer.prompt", "answer.temperature"]);
    for (const member of ["configuration", "configurationRead", "environment"]) {
      const without = { ...observed };
      delete without[member];
      expect(TrialResult.safeParse({ ...result, observed: without }).success, member).toBe(false);
    }
  });

  it("names the traces that the trial produced, with the spans ended in each", () => {
    const result = TrialResult.parse(fixture("valid-extra", "trialResult/traced.json"));
    expect(result.trace).toEqual({
      ids: ["4bf92f3577b34da6a3ce929d0e0e4736", "0af7651916cd43dd8448eb211c80319c"],
      spans: { "4bf92f3577b34da6a3ce929d0e0e4736": 7 },
      complete: true,
    });
    const record = fixture("valid-extra", "trialResult/traced.json");
    const trace = record["trace"] as Record<string, unknown>;
    // One count per trace: a single total cannot say which trace is short of spans.
    for (const spans of [7, { "not-a-trace-id": 7 }, { "4bf92f3577b34da6a3ce929d0e0e4736": -1 }])
      expect(TrialResult.safeParse({ ...record, trace: { ...trace, spans } }).success).toBe(false);
  });

  it("gives the names and paths that a worker chooses the class of the record's content", () => {
    // A worker may name a file after its input, so these strings take the record's class.
    const at = policyAt;
    const inherits = { class: "inherit", identifier: "quasi" };
    const artifact = ["properties", "artifacts", "items", "properties"];
    for (const path of [
      [...artifact, "name"],
      [...artifact, "path"],
      ["properties", "events", "items", "properties", "artifact"],
      ["properties", "observed", "properties", "environment"],
      ["properties", "observed", "properties", "modules"],
    ])
      expect(at("trialResult", path), path.join(".")).toMatchObject(inherits);
    const copy = ["properties", "units", "items", "properties", "artifacts", "items", "properties"];
    for (const key of ["name", "path"])
      expect(at("scoreRequest", [...copy, key]), key).toMatchObject(inherits);
    // The directories that Ichnaea makes for a request stay class none.
    expect(at("trialRequest", ["properties", "workdir"])).toMatchObject({ class: "none" });
  });

  it("takes no non-finite number anywhere, as strict JSON cannot hold one", () => {
    const result = fixture("valid", "trialResult.json");
    const timing = result["timing"] as Record<string, unknown>;
    expect(TrialResult.safeParse({ ...result, timing: { ...timing } }).success).toBe(true);
    for (const waitedMs of [Number.NaN, Number.POSITIVE_INFINITY, { nonFinite: "inf" }])
      expect(TrialResult.safeParse({ ...result, timing: { ...timing, waitedMs } }).success).toBe(
        false,
      );
  });

  it("announces ready with its capacity and the requests it reads", () => {
    const ready = WorkerReady.parse(fixture("valid", "workerReady.json"));
    expect(ready).toMatchObject({ capacity: 2, protocol: "ichnaea.trialRequest/1" });
    expect(contractFor("ichnaea.workerReady/1")?.schema).toBe(WorkerReady);
    // A process that can take no request is never ready.
    expect(WorkerReady.safeParse({ ...ready, capacity: 0 }).success).toBe(false);
    // A scorer uses the same framing and says that it reads score requests.
    const scorer = { ...ready, protocol: "ichnaea.scoreRequest/1" };
    expect(WorkerReady.safeParse(scorer).success).toBe(true);
  });

  it("keeps a trial alive with a heartbeat that reports the calls made so far", () => {
    const event = WorkerEvent.parse(fixture("valid", "workerEvent.json"));
    expect(event).toMatchObject({ kind: "heartbeat", calls: 2 });
    const valid = fixture("valid", "workerEvent.json");
    const without = { ...valid };
    delete without["calls"];
    // Without a count, a killed attempt counts the full per-trial bound: a writer always sends it.
    expect(WorkerEvent.safeParse(without).success).toBe(false);
    // A later minor version may add a kind of event with members of its own and no calls, which
    // a reader accepts and reports: the count belongs to the heartbeat, not to every event.
    const later: Record<string, unknown> = { ...valid, kind: "progress", share: 0.5 };
    delete later["calls"];
    expect(WorkerEvent.safeParse(later).success).toBe(false);
    const read = readRecord(contractFor("ichnaea.workerEvent/1")!, later);
    expect(read.ok && read.unknownValues.map((v) => v.value)).toEqual(["progress"]);
    // The schema ID stays strict for the reader: only the kind widens.
    expect(
      readRecord(contractFor("ichnaea.workerEvent/1")!, {
        ...later,
        schema: "ichnaea.workerEvent/2",
      }).ok,
    ).toBe(false);
  });

  it("reports a tool call as an event, with its arguments and result as content", () => {
    const event = WorkerEvent.parse(fixture("valid-extra", "workerEvent/tool-call.json"));
    expect(event).toMatchObject({
      kind: "tool_call",
      stage: "search",
      iteration: 0,
      call: { id: "call_01", name: "search_help_centre" },
    });
    const record = fixture("valid-extra", "workerEvent/tool-call.json");
    // A tool call carries content, so it states its class; a heartbeat counts calls instead.
    const withoutClass = { ...record };
    delete withoutClass["dataClass"];
    expect(WorkerEvent.safeParse(withoutClass).success).toBe(false);
    expect(WorkerEvent.safeParse({ ...record, calls: 2 }).success).toBe(false);
    for (const key of ["args", "result", "error"])
      expect(
        policyAt("workerEvent", ["oneOf", "1", "properties", "call", "properties", key]),
        key,
      ).toMatchObject({ class: "inherit", identifier: "content" });
  });

  it("cancels one trial by its identity, and says nothing else", () => {
    const cancel = Cancel.parse(fixture("valid", "cancel.json"));
    expect(Object.keys(cancel).toSorted()).toEqual(["schema", "trial"]);
    const reason = { ...fixture("valid", "cancel.json"), reason: "deadline" };
    expect(Cancel.safeParse(reason).success).toBe(false);
    expect(Cancel.safeParse({ schema: "ichnaea.cancel/1" }).success).toBe(false);
  });
});
