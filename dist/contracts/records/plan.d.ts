import * as z from "zod";
/** A versioned part that can change a verdict, with its hash (REQ-17). */
export declare const LineageItem: z.ZodObject<{
    kind: z.ZodEnum<{
        featureGate: "featureGate";
        gate: "gate";
        judge: "judge";
        measure: "measure";
        package: "package";
        plugin: "plugin";
        preset: "preset";
    }>;
    id: z.ZodString;
    version: z.ZodString;
    digest: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** The reason of a power entry whose margin is refused. Only that entry carries a `refusal`. */
export declare const REFUSED_MARGIN = "the plan carries no planning statement, and its margin is refused";
/** Why a power entry was not computed. */
export declare const PowerNotComputed: z.ZodEnum<{
    "fixed-cases needs at least 2 trials per case and arm": "fixed-cases needs at least 2 trials per case and arm";
    "no applicable case with a base value": "no applicable case with a base value";
    "run invalid": "run invalid";
    "the plan carries no planning statement, and its margin is refused": "the plan carries no planning statement, and its margin is refused";
    "the plan carries no planning statement, and none can be computed from it": "the plan carries no planning statement, and none can be computed from it";
}>;
/**
 * The power statement of one primary measure (REQ-54). An entry is computed, with its numbers and
 * the assumption behind them, or not computed, with the reason; it never holds a number that is not
 * one. `decidable` says whether the margin is within reach of the minimum detectable effect. Only
 * the plan's entry may switch a plan to estimate-only, before any call; a decision's run-time entry
 * describes the run and never changes its verdict or mode (decision 0017).
 */
export declare const PowerEntry: z.ZodDiscriminatedUnion<[z.ZodObject<{
    computed: z.ZodLiteral<true>;
    measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    applicableCases: z.ZodInt;
    replicates: z.ZodInt;
    margin: z.ZodNumber;
    mde: z.ZodNumber;
    floor: z.ZodNumber;
    sampledCasesFloor: z.ZodOptional<z.ZodNumber>;
    assumption: z.ZodString;
    decidable: z.ZodBoolean;
}, z.core.$strict>, z.ZodDiscriminatedUnion<[z.ZodObject<{
    computed: z.ZodLiteral<false>;
    measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    applicableCases: z.ZodInt;
    replicates: z.ZodInt;
    margin: z.ZodNumber;
    reason: z.ZodEnum<{
        "fixed-cases needs at least 2 trials per case and arm": "fixed-cases needs at least 2 trials per case and arm";
        "no applicable case with a base value": "no applicable case with a base value";
        "run invalid": "run invalid";
        "the plan carries no planning statement, and none can be computed from it": "the plan carries no planning statement, and none can be computed from it";
    }>;
}, z.core.$strict>, z.ZodObject<{
    computed: z.ZodLiteral<false>;
    measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    applicableCases: z.ZodInt;
    replicates: z.ZodInt;
    margin: z.ZodNumber;
    reason: z.ZodLiteral<"the plan carries no planning statement, and its margin is refused">;
    refusal: z.ZodString;
}, z.core.$strict>], "reason">], "computed">;
/** A power entry. */
export type PowerEntry = z.infer<typeof PowerEntry>;
/**
 * The reason of a power entry that was not computed, as a line prints it: the refused reason with
 * its refusal text.
 */
export declare function notComputedReason(entry: Extract<PowerEntry, {
    computed: false;
}>): string;
/**
 * One configuration of a plan with its role. A comparison has a `base` and one or more
 * `candidate` arms. An estimate-only run may have a single arm.
 */
export declare const Arm: z.ZodObject<{
    name: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
    role: z.ZodEnum<{
        base: "base";
        candidate: "candidate";
        reference: "reference";
    }>;
    identity: z.core.$ZodBranded<z.ZodString, "ConfigurationIdentity", "out">;
    configuration: z.ZodObject<{
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
    runs: z.ZodOptional<z.ZodLiteral<true>>;
}, z.core.$strict>;
/** One planned trial. `family` groups related cases (from the case set) for sampled-cases. */
export declare const PlannedTrial: z.ZodObject<{
    id: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
    case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
    family: z.ZodOptional<z.ZodString>;
    arm: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
    replicate: z.ZodInt;
    block: z.ZodOptional<z.ZodInt>;
    batch: z.ZodInt;
}, z.core.$strict>;
/** A decision record that a plan cites as A/A evidence: its run and its canonical digest. */
export declare const AaCitation: z.ZodObject<{
    run: z.core.$ZodBranded<z.ZodString, "RunId", "out">;
    digest: z.ZodString;
}, z.core.$strict>;
/**
 * The run settings that shape a run's schedule: how many trials run at once and the endpoint they
 * call. A/A evidence holds only for the same schedule.
 */
export declare const Schedule: z.ZodObject<{
    concurrency: z.ZodInt;
    endpoint: z.ZodString;
}, z.core.$strict>;
/** The trigger that caused a plan (REQ-149). */
export declare const TriggerKind: z.ZodEnum<{
    "case-set": "case-set";
    code: "code";
    configuration: "configuration";
    "configuration-outside": "configuration-outside";
    data: "data";
    dependency: "dependency";
    framework: "framework";
    judge: "judge";
    manual: "manual";
    "new-model": "new-model";
    "production-signal": "production-signal";
    "silent-change": "silent-change";
}>;
/** The resolved, locked form of a suite for one run (REQ-16). */
export declare const Plan: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.plan/1">;
    analysis: z.ZodOptional<z.ZodObject<{
        schema: z.ZodLiteral<"ichnaea.analysisPlan/1">;
        suite: z.core.$ZodBranded<z.ZodString, "SuiteId", "out">;
        suiteDigest: z.ZodString;
        cases: z.ZodArray<z.ZodObject<{
            id: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
            digest: z.ZodString;
            pool: z.ZodEnum<{
                development: "development";
                promoted: "promoted";
                sealed: "sealed";
                validation: "validation";
            }>;
            family: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        caseSet: z.ZodString;
        caseSetDigest: z.ZodString;
        estimand: z.ZodEnum<{
            "fixed-cases": "fixed-cases";
            "sampled-cases": "sampled-cases";
        }>;
        method: z.ZodEnum<{
            "binary-randomized-blocks": "binary-randomized-blocks";
            "estimate-only": "estimate-only";
        }>;
        alpha: z.ZodNumber;
        blocks: z.ZodInt;
        replicates: z.ZodInt;
        primary: z.ZodArray<z.ZodObject<{
            measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
            margin: z.ZodOptional<z.ZodNumber>;
            safetyMargin: z.ZodOptional<z.ZodNumber>;
            targetDrop: z.ZodOptional<z.ZodNumber>;
            coverageFloor: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        secondary: z.ZodArray<z.core.$ZodBranded<z.ZodString, "MeasureId", "out">>;
        hardGates: z.ZodArray<z.core.$ZodBranded<z.ZodString, "GateId", "out">>;
        measures: z.ZodArray<z.ZodObject<{
            id: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
            version: z.ZodString;
            pin: z.ZodString;
        }, z.core.$strict>>;
        holm: z.ZodArray<z.core.$ZodBranded<z.ZodString, "MeasureId", "out">>;
        applicability: z.ZodRecord<z.core.$ZodBranded<z.ZodString, "MeasureId", "out">, z.ZodArray<z.core.$ZodBranded<z.ZodString, "CaseId", "out">>>;
        resolution: z.ZodOptional<z.ZodArray<z.ZodObject<{
            measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
            basis: z.ZodEnum<{
                "base-arm-rates": "base-arm-rates";
                "default-simulation": "default-simulation";
                "noise-pilot": "noise-pilot";
            }>;
            targetPower: z.ZodNumber;
            level: z.ZodNumber;
            targetDrop: z.ZodOptional<z.ZodNumber>;
            powerAtTarget: z.ZodOptional<z.ZodNumber>;
            result: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"detectable-drop">;
                drop: z.ZodNumber;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"extreme">;
                power: z.ZodNumber;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"unavailable">;
                reason: z.ZodString;
            }, z.core.$strict>], "kind">;
        }, z.core.$strict>>>;
        trialReduction: z.ZodOptional<z.ZodObject<{
            measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
            k: z.ZodInt;
            cases: z.ZodArray<z.core.$ZodBranded<z.ZodString, "CaseId", "out">>;
        }, z.core.$strict>>;
        pilot: z.ZodOptional<z.ZodObject<{
            run: z.core.$ZodBranded<z.ZodString, "RunId", "out">;
            digest: z.ZodString;
        }, z.core.$strict>>;
        base: z.ZodObject<{
            role: z.ZodLiteral<"base">;
            identity: z.core.$ZodBranded<z.ZodString, "ConfigurationIdentity", "out">;
        }, z.core.$strict>;
        maxCalls: z.ZodInt;
        policy: z.ZodObject<{
            onRegression: z.ZodEnum<{
                block: "block";
                report: "report";
            }>;
            onInconclusive: z.ZodEnum<{
                block: "block";
                report: "report";
            }>;
            onEstimateOnly: z.ZodEnum<{
                block: "block";
                report: "report";
            }>;
        }, z.core.$strict>;
        ichnaea: z.ZodString;
    }, z.core.$strict>>;
    suite: z.core.$ZodBranded<z.ZodString, "SuiteId", "out">;
    suiteVersion: z.ZodString;
    suiteDigest: z.ZodString;
    caseSet: z.core.$ZodBranded<z.ZodString, "CaseSetId", "out">;
    caseSetDigest: z.ZodString;
    trigger: z.ZodEnum<{
        "case-set": "case-set";
        code: "code";
        configuration: "configuration";
        "configuration-outside": "configuration-outside";
        data: "data";
        dependency: "dependency";
        framework: "framework";
        judge: "judge";
        manual: "manual";
        "new-model": "new-model";
        "production-signal": "production-signal";
        "silent-change": "silent-change";
    }>;
    varies: z.ZodArray<z.ZodString>;
    mode: z.ZodEnum<{
        decision: "decision";
        "estimate-only": "estimate-only";
    }>;
    modeReasons: z.ZodArray<z.ZodString>;
    estimand: z.ZodEnum<{
        "fixed-cases": "fixed-cases";
        "sampled-cases": "sampled-cases";
    }>;
    alpha: z.ZodNumber;
    replicates: z.ZodInt;
    arms: z.ZodArray<z.ZodObject<{
        name: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
        role: z.ZodEnum<{
            base: "base";
            candidate: "candidate";
            reference: "reference";
        }>;
        identity: z.core.$ZodBranded<z.ZodString, "ConfigurationIdentity", "out">;
        configuration: z.ZodObject<{
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
        runs: z.ZodOptional<z.ZodLiteral<true>>;
    }, z.core.$strict>>;
    measures: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            featureGate: "featureGate";
            gate: "gate";
            judge: "judge";
            measure: "measure";
            package: "package";
            plugin: "plugin";
            preset: "preset";
        }>;
        id: z.ZodString;
        version: z.ZodString;
        digest: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    primary: z.ZodArray<z.ZodObject<{
        measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
        margin: z.ZodNumber;
        marginStatus: z.ZodEnum<{
            placeholder: "placeholder";
            registered: "registered";
        }>;
        marginReason: z.ZodString;
        safetyMargin: z.ZodOptional<z.ZodNumber>;
        coverageFloor: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    secondary: z.ZodArray<z.core.$ZodBranded<z.ZodString, "MeasureId", "out">>;
    hardGates: z.ZodArray<z.core.$ZodBranded<z.ZodString, "GateId", "out">>;
    policy: z.ZodObject<{
        onRegression: z.ZodEnum<{
            block: "block";
            report: "report";
        }>;
        onInconclusive: z.ZodEnum<{
            block: "block";
            report: "report";
        }>;
        onEstimateOnly: z.ZodEnum<{
            block: "block";
            report: "report";
        }>;
    }, z.core.$strict>;
    power: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        computed: z.ZodLiteral<true>;
        measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
        applicableCases: z.ZodInt;
        replicates: z.ZodInt;
        margin: z.ZodNumber;
        mde: z.ZodNumber;
        floor: z.ZodNumber;
        sampledCasesFloor: z.ZodOptional<z.ZodNumber>;
        assumption: z.ZodString;
        decidable: z.ZodBoolean;
    }, z.core.$strict>, z.ZodDiscriminatedUnion<[z.ZodObject<{
        computed: z.ZodLiteral<false>;
        measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
        applicableCases: z.ZodInt;
        replicates: z.ZodInt;
        margin: z.ZodNumber;
        reason: z.ZodEnum<{
            "fixed-cases needs at least 2 trials per case and arm": "fixed-cases needs at least 2 trials per case and arm";
            "no applicable case with a base value": "no applicable case with a base value";
            "run invalid": "run invalid";
            "the plan carries no planning statement, and none can be computed from it": "the plan carries no planning statement, and none can be computed from it";
        }>;
    }, z.core.$strict>, z.ZodObject<{
        computed: z.ZodLiteral<false>;
        measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
        applicableCases: z.ZodInt;
        replicates: z.ZodInt;
        margin: z.ZodNumber;
        reason: z.ZodLiteral<"the plan carries no planning statement, and its margin is refused">;
        refusal: z.ZodString;
    }, z.core.$strict>], "reason">], "computed">>;
    budget: z.ZodObject<{
        worstCaseCalls: z.ZodInt;
        maxCalls: z.ZodInt;
        callsPerTrial: z.ZodOptional<z.ZodInt>;
        monthlyRemaining: z.ZodOptional<z.ZodInt>;
    }, z.core.$strict>;
    trials: z.ZodArray<z.ZodObject<{
        id: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
        case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
        family: z.ZodOptional<z.ZodString>;
        arm: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
        replicate: z.ZodInt;
        block: z.ZodOptional<z.ZodInt>;
        batch: z.ZodInt;
    }, z.core.$strict>>;
    schedule: z.ZodOptional<z.ZodObject<{
        concurrency: z.ZodInt;
        endpoint: z.ZodString;
    }, z.core.$strict>>;
    aa: z.ZodOptional<z.ZodObject<{
        decisions: z.ZodArray<z.ZodObject<{
            run: z.core.$ZodBranded<z.ZodString, "RunId", "out">;
            digest: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    seed: z.ZodObject<{
        algorithm: z.ZodString;
        value: z.ZodString;
    }, z.core.$strict>;
    createdAt: z.ZodISODateTime;
    ichnaea: z.ZodString;
}, z.core.$strict>;
/** A plan. */
export type Plan = z.infer<typeof Plan>;
//# sourceMappingURL=plan.d.ts.map