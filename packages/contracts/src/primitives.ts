import * as z from "zod";

import { DATA_CLASSES, none } from "./data-class.ts";

/** A content digest: `sha256:` and 64 lowercase hex digits of an RFC 8785 canonical form. */
export const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
/** A content digest. */
export type Digest = z.infer<typeof Digest>;

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const id = (): z.ZodString => z.string().regex(idPattern);

/** A non-empty string. */
export const Text = z.string().min(1);

/** A case identifier, unique within a case set. */
export const CaseId = id().brand<"CaseId">();
/** A case identifier. */
export type CaseId = z.infer<typeof CaseId>;
/** A trial identifier, unique within a run. */
export const TrialId = id().brand<"TrialId">();
/** A trial identifier. */
export type TrialId = z.infer<typeof TrialId>;
/** A run identifier. */
export const RunId = id().brand<"RunId">();
/** A run identifier. */
export type RunId = z.infer<typeof RunId>;
/** A case set identifier. */
export const CaseSetId = id().brand<"CaseSetId">();
/** A case set identifier. */
export type CaseSetId = z.infer<typeof CaseSetId>;
/** A suite identifier. */
export const SuiteId = id().brand<"SuiteId">();
/** A suite identifier. */
export type SuiteId = z.infer<typeof SuiteId>;
/** A finding identifier. */
export const FindingId = id().brand<"FindingId">();
/** A finding identifier. */
export type FindingId = z.infer<typeof FindingId>;
/** A monitor identifier. */
export const MonitorId = id().brand<"MonitorId">();
/** A monitor identifier. */
export type MonitorId = z.infer<typeof MonitorId>;
/** The name of an arm (a compared configuration) within a plan, for example `base`. */
export const ArmName = id().brand<"ArmName">();
/** An arm name. */
export type ArmName = z.infer<typeof ArmName>;

const namespaced = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/;
/** A namespaced measure identifier, `<plugin>/<measure>`. */
export const MeasureId = z.string().regex(namespaced).brand<"MeasureId">();
/** A measure identifier. */
export type MeasureId = z.infer<typeof MeasureId>;
/** A namespaced judge identifier, `<plugin>/<judge>`. */
export const JudgeId = z.string().regex(namespaced).brand<"JudgeId">();
/** A judge identifier. */
export type JudgeId = z.infer<typeof JudgeId>;
/** A namespaced hard-gate identifier, `<plugin>/<gate>`. */
export const GateId = z.string().regex(namespaced).brand<"GateId">();
/** A hard-gate identifier. */
export type GateId = z.infer<typeof GateId>;

/** The digest of a resolved plan. */
export const PlanDigest = Digest.brand<"PlanDigest">();
/** A plan digest. */
export type PlanDigest = z.infer<typeof PlanDigest>;
/** The identity of a resolved system configuration. */
export const ConfigurationIdentity = Digest.brand<"ConfigurationIdentity">();
/** A configuration identity. */
export type ConfigurationIdentity = z.infer<typeof ConfigurationIdentity>;

/** A semantic version. */
export const SemVer = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);

/** An ISO 8601 timestamp with a `Z` suffix or a numeric offset. */
export const Timestamp = z.iso.datetime({ offset: true });
/** A calendar date, `YYYY-MM-DD`. */
export const CalendarDate = z.iso.date();

/** Any JSON value. Records never hold non-JSON values. */
export const Json: z.ZodJSONSchema = z.json();
/** Any JSON value. */
export type Json = z.infer<typeof Json>;

/** An explicit encoding of a non-finite number, because JSON has none (REQ-04). */
export const NonFinite = z.object({ nonFinite: none(z.enum(["nan", "inf", "-inf"])) });
/** A real number or an explicit non-finite marker. */
export const Real = z.union([z.number(), NonFinite]);
/** A real number or an explicit non-finite marker. */
export type Real = z.infer<typeof Real>;

/** A probability or proportion in [0, 1]. */
export const Probability = z.number().min(0).max(1);

/** The personal-data class of a record's content fields. */
export const RecordDataClass = z.enum(DATA_CLASSES);

/** The unit of a case or trial (REQ-09). */
export const Unit = z.enum(["turn", "trace", "session", "episode"]);
/** The unit of a case or trial. */
export type Unit = z.infer<typeof Unit>;

/** A seed of a named generator, as decimal digits so 64-bit seeds fit. */
export const Seed = z.object({
  algorithm: none(Text),
  value: none(z.string().regex(/^\d{1,20}$/)),
});

/** A named pointer to a file or artefact with its digest. */
export const DigestRef = z.object({
  name: none(Text),
  digest: none(Digest),
  uri: none(Text).optional(),
});

/**
 * The result of one measurement or annotation, tagged by kind: a pass or fail, a score, a level
 * of an anchored scale, or a preference between two outputs.
 */
export const MeasuredValue = z.discriminatedUnion("type", [
  z.object({ type: none(z.literal("binary")), pass: none(z.boolean()) }),
  z.object({ type: none(z.literal("score")), value: none(Real) }),
  z.object({ type: none(z.literal("level")), level: none(Text) }),
  z.object({
    type: none(z.literal("preference")),
    preferred: none(z.enum(["first", "second", "tie"])),
  }),
]);
/** A measured value. */
export type MeasuredValue = z.infer<typeof MeasuredValue>;
