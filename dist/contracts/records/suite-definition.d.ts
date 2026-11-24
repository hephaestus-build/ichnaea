import * as z from "zod";
export declare const ArmDefinition: z.ZodUnion<readonly [z.ZodObject<{
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
}, z.core.$strict>, z.ZodString, z.ZodObject<{
    model: z.ZodString;
    provider: z.ZodOptional<z.ZodString>;
    prompt: z.ZodOptional<z.ZodString>;
    parameters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
}, z.core.$strict>]>;
export type ArmDefinition = z.input<typeof ArmDefinition>;
/** The suite and the paths its configuration resolves. */
export declare const SuiteDefinition: z.ZodObject<{
    id: z.core.$ZodBranded<z.ZodString, "SuiteId", "out">;
    version: z.ZodOptional<z.ZodString>;
    cases: z.ZodString;
    caseSet: z.ZodOptional<z.ZodString>;
    caseDefaults: z.ZodOptional<z.ZodObject<{
        unit: z.ZodOptional<z.ZodEnum<{
            episode: "episode";
            session: "session";
            trace: "trace";
            turn: "turn";
        }>>;
        dataClass: z.ZodOptional<z.ZodEnum<{
            none: "none";
            personal: "personal";
            pseudonymous: "pseudonymous";
            special: "special";
        }>>;
        provenance: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
            selection: z.ZodEnum<{
                curated: "curated";
                generated: "generated";
                promoted: "promoted";
                random: "random";
            }>;
            author: z.ZodOptional<z.ZodString>;
            created: z.ZodISODate;
            collected: z.ZodOptional<z.ZodISODate>;
            licence: z.ZodString;
            exposure: z.ZodEnum<{
                private: "private";
                public: "public";
                sealed: "sealed";
            }>;
            source: z.ZodLiteral<"authored">;
        }, z.core.$strict>, z.ZodObject<{
            selection: z.ZodEnum<{
                curated: "curated";
                generated: "generated";
                promoted: "promoted";
                random: "random";
            }>;
            author: z.ZodOptional<z.ZodString>;
            created: z.ZodISODate;
            collected: z.ZodOptional<z.ZodISODate>;
            licence: z.ZodString;
            exposure: z.ZodEnum<{
                private: "private";
                public: "public";
                sealed: "sealed";
            }>;
            source: z.ZodLiteral<"generated">;
            generator: z.ZodObject<{
                method: z.ZodString;
                model: z.ZodOptional<z.ZodString>;
                seedSource: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            selection: z.ZodEnum<{
                curated: "curated";
                generated: "generated";
                promoted: "promoted";
                random: "random";
            }>;
            author: z.ZodOptional<z.ZodString>;
            created: z.ZodISODate;
            collected: z.ZodOptional<z.ZodISODate>;
            licence: z.ZodString;
            exposure: z.ZodEnum<{
                private: "private";
                public: "public";
                sealed: "sealed";
            }>;
            source: z.ZodLiteral<"reused">;
            reusedDataset: z.ZodObject<{
                name: z.ZodString;
                version: z.ZodOptional<z.ZodString>;
                limits: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            selection: z.ZodEnum<{
                curated: "curated";
                generated: "generated";
                promoted: "promoted";
                random: "random";
            }>;
            author: z.ZodOptional<z.ZodString>;
            created: z.ZodISODate;
            licence: z.ZodString;
            exposure: z.ZodEnum<{
                private: "private";
                public: "public";
                sealed: "sealed";
            }>;
            source: z.ZodLiteral<"collected">;
            collected: z.ZodISODate;
        }, z.core.$strict>, z.ZodObject<{
            selection: z.ZodEnum<{
                curated: "curated";
                generated: "generated";
                promoted: "promoted";
                random: "random";
            }>;
            author: z.ZodOptional<z.ZodString>;
            created: z.ZodISODate;
            collected: z.ZodOptional<z.ZodISODate>;
            licence: z.ZodString;
            exposure: z.ZodEnum<{
                private: "private";
                public: "public";
                sealed: "sealed";
            }>;
            source: z.ZodLiteral<"promoted">;
            finding: z.core.$ZodBranded<z.ZodString, "FindingId", "out">;
        }, z.core.$strict>], "source">>;
        pool: z.ZodOptional<z.ZodEnum<{
            development: "development";
            promoted: "promoted";
            sealed: "sealed";
            validation: "validation";
        }>>;
    }, z.core.$strict>>;
    arms: z.ZodObject<{
        base: z.ZodUnion<readonly [z.ZodObject<{
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
        }, z.core.$strict>, z.ZodString, z.ZodObject<{
            model: z.ZodString;
            provider: z.ZodOptional<z.ZodString>;
            prompt: z.ZodOptional<z.ZodString>;
            parameters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        }, z.core.$strict>]>;
        candidate: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
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
        }, z.core.$strict>, z.ZodString, z.ZodObject<{
            model: z.ZodString;
            provider: z.ZodOptional<z.ZodString>;
            prompt: z.ZodOptional<z.ZodString>;
            parameters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        }, z.core.$strict>]>>;
    }, z.core.$strict>;
    objective: z.ZodString;
    construct: z.ZodString;
    decision: z.ZodString;
    scope: z.ZodString;
    nonCoverage: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
    estimand: z.ZodOptional<z.ZodEnum<{
        "fixed-cases": "fixed-cases";
        "sampled-cases": "sampled-cases";
    }>>;
    alpha: z.ZodOptional<z.ZodNumber>;
    blocks: z.ZodOptional<z.ZodInt>;
    replicates: z.ZodOptional<z.ZodInt>;
    primary: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.core.$ZodBranded<z.ZodString, "MeasureId", "out">, z.ZodObject<{
        measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
        margin: z.ZodOptional<z.ZodNumber>;
        safetyMargin: z.ZodOptional<z.ZodNumber>;
        targetDrop: z.ZodOptional<z.ZodNumber>;
        coverageFloor: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>]>>>;
    secondary: z.ZodOptional<z.ZodArray<z.core.$ZodBranded<z.ZodString, "MeasureId", "out">>>;
    hardGates: z.ZodOptional<z.ZodArray<z.core.$ZodBranded<z.ZodString, "GateId", "out">>>;
    trialReduction: z.ZodOptional<z.ZodObject<{
        measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
        k: z.ZodInt;
        cases: z.ZodArray<z.core.$ZodBranded<z.ZodString, "CaseId", "out">>;
    }, z.core.$strict>>;
    mustNever: z.ZodOptional<z.ZodArray<z.ZodObject<{
        measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
        cases: z.ZodArray<z.core.$ZodBranded<z.ZodString, "CaseId", "out">>;
        scope: z.ZodString;
        detector: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"deterministic">;
            variants: z.ZodArray<z.ZodObject<{
                pattern: z.ZodString;
                positiveControl: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"model">;
        }, z.core.$strict>], "kind">;
    }, z.core.$strict>>>;
    maxCalls: z.ZodOptional<z.ZodInt>;
    purpose: z.ZodOptional<z.ZodEnum<{
        confirmation: "confirmation";
        development: "development";
        regression: "regression";
    }>>;
    callsPerTrial: z.ZodOptional<z.ZodInt>;
    deadlineMs: z.ZodOptional<z.ZodInt>;
    policy: z.ZodOptional<z.ZodObject<{
        onRegression: z.ZodEnum<{
            block: "block";
            report: "report";
        }>;
        onInconclusive: z.ZodEnum<{
            block: "block";
            report: "report";
        }>;
        onRunDrop: z.ZodOptional<z.ZodEnum<{
            block: "block";
            report: "report";
        }>>;
        onEstimateOnly: z.ZodEnum<{
            block: "block";
            report: "report";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** The authored suite configuration. */
export type SuiteDefinition = z.input<typeof SuiteDefinition>;
/** Defines the case source, measures and arms for a suite. */
export declare function defineSuite(suite: SuiteDefinition): SuiteDefinition;
//# sourceMappingURL=suite-definition.d.ts.map