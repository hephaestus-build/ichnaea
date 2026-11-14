import * as z from "zod";

import { DATA_CLASSES, none } from "./data-class.ts";

/** A content digest: `sha256:` and 64 lowercase hex digits of an RFC 8785 canonical form. */
export const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
/** A content digest. */
export type Digest = z.infer<typeof Digest>;

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const id = (): z.ZodString => z.string().regex(idPattern);

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

/** A UTC timestamp in ISO 8601 with a `Z` suffix. */
export const Timestamp = z.iso.datetime();
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

/** A named pointer to a file or artefact with its digest. */
export const DigestRef = z.object({
  name: none(z.string().min(1)),
  digest: none(Digest),
  uri: none(z.string().min(1)).optional(),
});
