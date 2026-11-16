import * as z from "zod";
/** Control status of a factor. */
export declare const FactorStatus: z.ZodEnum<{
    declared: "declared";
    observed: "observed";
    pinned: "pinned";
    uncontrollable: "uncontrollable";
}>;
/** A factor's control status. */
export type FactorStatus = z.infer<typeof FactorStatus>;
/** The part of the system a factor belongs to. */
export declare const FactorPart: z.ZodEnum<{
    code: "code";
    data: "data";
    model: "model";
    other: "other";
    parameter: "parameter";
    prompt: "prompt";
    runtime: "runtime";
    setting: "setting";
    tool: "tool";
}>;
/** The part of the system a factor belongs to. */
export type FactorPart = z.infer<typeof FactorPart>;
/** One element of a configuration with its value and control status (REQ-14). */
export declare const Factor: z.ZodObject<{
    value: z.ZodJSONSchema;
    status: z.ZodEnum<{
        declared: "declared";
        observed: "observed";
        pinned: "pinned";
        uncontrollable: "uncontrollable";
    }>;
    part: z.ZodEnum<{
        code: "code";
        data: "data";
        model: "model";
        other: "other";
        parameter: "parameter";
        prompt: "prompt";
        runtime: "runtime";
        setting: "setting";
        tool: "tool";
    }>;
}, z.core.$strict>;
/** A factor. */
export type Factor = z.infer<typeof Factor>;
/** A named value of the model's identity with its control status. Never empty. */
export declare const IdentityFactor: z.ZodObject<{
    value: z.ZodString;
    status: z.ZodEnum<{
        declared: "declared";
        pinned: "pinned";
    }>;
}, z.core.$strict>;
/** One model the system uses, under a role name (for example `answer` or `rerank`). */
export declare const ModelBinding: z.ZodObject<{
    role: z.ZodString;
    provider: z.ZodObject<{
        value: z.ZodString;
        status: z.ZodEnum<{
            declared: "declared";
            pinned: "pinned";
        }>;
    }, z.core.$strict>;
    id: z.ZodObject<{
        value: z.ZodString;
        status: z.ZodEnum<{
            declared: "declared";
            pinned: "pinned";
        }>;
    }, z.core.$strict>;
    version: z.ZodOptional<z.ZodObject<{
        value: z.ZodString;
        status: z.ZodEnum<{
            declared: "declared";
            pinned: "pinned";
        }>;
    }, z.core.$strict>>;
    route: z.ZodOptional<z.ZodObject<{
        value: z.ZodString;
        status: z.ZodEnum<{
            declared: "declared";
            pinned: "pinned";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/**
 * One generation parameter. `origin: "default"` records a value the system did not set and the
 * provider applies, so all parameters are recorded, set or not (REQ-14).
 */
export declare const Parameter: z.ZodObject<{
    name: z.ZodString;
    value: z.ZodJSONSchema;
    status: z.ZodEnum<{
        declared: "declared";
        pinned: "pinned";
        uncontrollable: "uncontrollable";
    }>;
    origin: z.ZodEnum<{
        default: "default";
        explicit: "explicit";
    }>;
}, z.core.$strict>;
/**
 * A prompt template the system uses, by digest: the SHA-256 of the template's UTF-8 bytes. The
 * template text and its uri may be recorded; they do not enter the identity (`DIGEST_RULES`).
 */
export declare const PromptBinding: z.ZodObject<{
    name: z.ZodString;
    digest: z.ZodString;
    status: z.ZodEnum<{
        declared: "declared";
        observed: "observed";
        pinned: "pinned";
        uncontrollable: "uncontrollable";
    }>;
    template: z.ZodOptional<z.ZodString>;
    uri: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/**
 * A resolved system configuration (REQ-14, REQ-148).
 *
 * At least one model with a non-empty provider and ID, and at least one generation parameter,
 * are required, so a configuration without them does not validate. Everything else that decides
 * behaviour goes into `factors` under a dotted name, for example `code.commit`,
 * `tool.retrieval.topK` or `data.corpus`. An `observed` factor is a value the system reported when
 * the configuration was resolved (for example a corpus digest); it is part of the identity.
 * Per-trial observations, such as the model identity a provider returns or a provider fingerprint,
 * belong in trial records, never here, so they never change the identity.
 */
export declare const Configuration: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.configuration/1">;
    description: z.ZodString;
    models: z.ZodArray<z.ZodObject<{
        role: z.ZodString;
        provider: z.ZodObject<{
            value: z.ZodString;
            status: z.ZodEnum<{
                declared: "declared";
                pinned: "pinned";
            }>;
        }, z.core.$strict>;
        id: z.ZodObject<{
            value: z.ZodString;
            status: z.ZodEnum<{
                declared: "declared";
                pinned: "pinned";
            }>;
        }, z.core.$strict>;
        version: z.ZodOptional<z.ZodObject<{
            value: z.ZodString;
            status: z.ZodEnum<{
                declared: "declared";
                pinned: "pinned";
            }>;
        }, z.core.$strict>>;
        route: z.ZodOptional<z.ZodObject<{
            value: z.ZodString;
            status: z.ZodEnum<{
                declared: "declared";
                pinned: "pinned";
            }>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    parameters: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        value: z.ZodJSONSchema;
        status: z.ZodEnum<{
            declared: "declared";
            pinned: "pinned";
            uncontrollable: "uncontrollable";
        }>;
        origin: z.ZodEnum<{
            default: "default";
            explicit: "explicit";
        }>;
    }, z.core.$strict>>;
    prompts: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        digest: z.ZodString;
        status: z.ZodEnum<{
            declared: "declared";
            observed: "observed";
            pinned: "pinned";
            uncontrollable: "uncontrollable";
        }>;
        template: z.ZodOptional<z.ZodString>;
        uri: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    factors: z.ZodRecord<z.ZodString, z.ZodObject<{
        value: z.ZodJSONSchema;
        status: z.ZodEnum<{
            declared: "declared";
            observed: "observed";
            pinned: "pinned";
            uncontrollable: "uncontrollable";
        }>;
        part: z.ZodEnum<{
            code: "code";
            data: "data";
            model: "model";
            other: "other";
            parameter: "parameter";
            prompt: "prompt";
            runtime: "runtime";
            setting: "setting";
            tool: "tool";
        }>;
    }, z.core.$strict>>;
    label: z.ZodOptional<z.ZodString>;
    informational: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
}, z.core.$strict>;
/** A resolved system configuration. */
export type Configuration = z.infer<typeof Configuration>;
//# sourceMappingURL=configuration.d.ts.map