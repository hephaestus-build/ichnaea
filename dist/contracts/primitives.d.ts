import * as z from "zod";
/** A content digest: `sha256:` and 64 lowercase hex digits of an RFC 8785 canonical form. */
export declare const Digest: z.ZodString;
/** A content digest. */
export type Digest = z.infer<typeof Digest>;
/** A non-empty string. */
export declare const Text: z.ZodString;
/** A case identifier, unique within a case set. */
export declare const CaseId: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
/** A case identifier. */
export type CaseId = z.infer<typeof CaseId>;
/** A trial identifier, unique within a run. */
export declare const TrialId: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
/** A trial identifier. */
export type TrialId = z.infer<typeof TrialId>;
/** A run identifier. */
export declare const RunId: z.core.$ZodBranded<z.ZodString, "RunId", "out">;
/** A run identifier. */
export type RunId = z.infer<typeof RunId>;
/** A case set identifier. */
export declare const CaseSetId: z.core.$ZodBranded<z.ZodString, "CaseSetId", "out">;
/** A case set identifier. */
export type CaseSetId = z.infer<typeof CaseSetId>;
/** A suite identifier. */
export declare const SuiteId: z.core.$ZodBranded<z.ZodString, "SuiteId", "out">;
/** A suite identifier. */
export type SuiteId = z.infer<typeof SuiteId>;
/** A finding identifier. */
export declare const FindingId: z.core.$ZodBranded<z.ZodString, "FindingId", "out">;
/** A finding identifier. */
export type FindingId = z.infer<typeof FindingId>;
/** A monitor identifier. */
export declare const MonitorId: z.core.$ZodBranded<z.ZodString, "MonitorId", "out">;
/** A monitor identifier. */
export type MonitorId = z.infer<typeof MonitorId>;
/** The name of an arm (a compared configuration) within a plan, for example `base`. */
export declare const ArmName: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
/** An arm name. */
export type ArmName = z.infer<typeof ArmName>;
/** A namespaced measure identifier, `<plugin>/<measure>`. */
export declare const MeasureId: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
/** A measure identifier. */
export type MeasureId = z.infer<typeof MeasureId>;
/** A namespaced judge identifier, `<plugin>/<judge>`. */
export declare const JudgeId: z.core.$ZodBranded<z.ZodString, "JudgeId", "out">;
/** A judge identifier. */
export type JudgeId = z.infer<typeof JudgeId>;
/** A namespaced hard-gate identifier, `<plugin>/<gate>`. */
export declare const GateId: z.core.$ZodBranded<z.ZodString, "GateId", "out">;
/** A hard-gate identifier. */
export type GateId = z.infer<typeof GateId>;
/** The digest of a resolved plan. */
export declare const PlanDigest: z.core.$ZodBranded<z.ZodString, "PlanDigest", "out">;
/** A plan digest. */
export type PlanDigest = z.infer<typeof PlanDigest>;
/** The identity of a resolved system configuration. */
export declare const ConfigurationIdentity: z.core.$ZodBranded<z.ZodString, "ConfigurationIdentity", "out">;
/** A configuration identity. */
export type ConfigurationIdentity = z.infer<typeof ConfigurationIdentity>;
/** A semantic version. */
export declare const SemVer: z.ZodString;
/** An ISO 8601 timestamp with a `Z` suffix or a numeric offset. */
export declare const Timestamp: z.ZodISODateTime;
/** A calendar date, `YYYY-MM-DD`. */
export declare const CalendarDate: z.ZodISODate;
/** Any JSON value. Records never hold non-JSON values. */
export declare const Json: z.ZodJSONSchema;
/** Any JSON value. */
export type Json = z.infer<typeof Json>;
/** An explicit encoding of a non-finite number, because JSON has none (REQ-04). */
export declare const NonFinite: z.ZodObject<{
    nonFinite: z.ZodEnum<{
        "-inf": "-inf";
        inf: "inf";
        nan: "nan";
    }>;
}, z.core.$strict>;
/** A real number or an explicit non-finite marker. */
export declare const Real: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
    nonFinite: z.ZodEnum<{
        "-inf": "-inf";
        inf: "inf";
        nan: "nan";
    }>;
}, z.core.$strict>]>;
/** A real number or an explicit non-finite marker. */
export type Real = z.infer<typeof Real>;
/** A probability or proportion in [0, 1]. */
export declare const Probability: z.ZodNumber;
/** The personal-data class of a record's content fields. */
export declare const RecordDataClass: z.ZodEnum<{
    none: "none";
    personal: "personal";
    pseudonymous: "pseudonymous";
    special: "special";
}>;
/** The unit of a case or trial (REQ-09). */
export declare const Unit: z.ZodEnum<{
    episode: "episode";
    session: "session";
    trace: "trace";
    turn: "turn";
}>;
/** The unit of a case or trial. */
export type Unit = z.infer<typeof Unit>;
/**
 * A seed of a named generator, in decimal without leading zeros. Exactly the integers from 0 to
 * 2^64 - 1 are valid: every unsigned 64-bit seed is accepted and no larger value is.
 */
export declare const Seed: z.ZodObject<{
    algorithm: z.ZodString;
    value: z.ZodString;
}, z.core.$strict>;
/** A named pointer to a file or artefact with its digest. */
export declare const DigestRef: z.ZodObject<{
    name: z.ZodString;
    digest: z.ZodString;
    uri: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/**
 * The result of one measurement or annotation, tagged by kind: a pass or fail, a score, a level
 * of an anchored scale, a preference between two outputs, an explicit `unknown` (a rater or judge
 * that cannot tell), or a proportion of items inside one
 * trial (for example the expected findings an output raised: 3 of 4). A schema cannot compare two
 * fields, so a proportion whose successes exceed its trials validates here. `proportionProblem`
 * names it; a step that uses the value must call it, because reading a record does not.
 */
export declare const MeasuredValue: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"binary">;
    pass: z.ZodBoolean;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"score">;
    value: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
        nonFinite: z.ZodEnum<{
            "-inf": "-inf";
            inf: "inf";
            nan: "nan";
        }>;
    }, z.core.$strict>]>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"proportion">;
    successes: z.ZodInt;
    trials: z.ZodInt;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"level">;
    level: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"preference">;
    preferred: z.ZodEnum<{
        first: "first";
        second: "second";
        tie: "tie";
    }>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"unknown">;
}, z.core.$strict>], "type">;
/** A measured value. */
export type MeasuredValue = z.infer<typeof MeasuredValue>;
//# sourceMappingURL=primitives.d.ts.map