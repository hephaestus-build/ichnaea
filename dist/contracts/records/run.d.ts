import * as z from "zod";
/** The runtime that computed a record: its name, version, operating system and architecture. */
export declare const Runtime: z.ZodObject<{
    name: z.ZodString;
    version: z.ZodString;
    platform: z.ZodString;
    arch: z.ZodString;
}, z.core.$strict>;
/** A runtime. */
export type Runtime = z.infer<typeof Runtime>;
/** The state of one planned trial in the ledger (REQ-19). */
export declare const LedgerEntry: z.ZodObject<{
    trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
    state: z.ZodEnum<{
        planned: "planned";
        recorded: "recorded";
        running: "running";
    }>;
    outcome: z.ZodOptional<z.ZodEnum<{
        abstained: "abstained";
        budget_exceeded: "budget_exceeded";
        completed: "completed";
        infrastructure_failure: "infrastructure_failure";
        invalid_configuration: "invalid_configuration";
        not_run: "not_run";
        protocol_failure: "protocol_failure";
        system_failure: "system_failure";
    }>>;
}, z.core.$strict>;
/**
 * A run: the ledger of a plan's trials, the configurations it ran (with their identities, so a
 * run without a model identity or a generation parameter does not validate), and the lineage of
 * everything that can change a verdict.
 */
export declare const Run: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.run/1">;
    id: z.core.$ZodBranded<z.ZodString, "RunId", "out">;
    plan: z.core.$ZodBranded<z.ZodString, "PlanDigest", "out">;
    exploratory: z.ZodBoolean;
    environment: z.ZodObject<{
        node: z.ZodString;
        platform: z.ZodString;
        ichnaea: z.ZodString;
        ci: z.ZodOptional<z.ZodString>;
        arch: z.ZodOptional<z.ZodString>;
        runtime: z.ZodOptional<z.ZodObject<{
            name: z.ZodString;
            version: z.ZodString;
            platform: z.ZodString;
            arch: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
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
    lineage: z.ZodArray<z.ZodObject<{
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
    ledger: z.ZodArray<z.ZodObject<{
        trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
        state: z.ZodEnum<{
            planned: "planned";
            recorded: "recorded";
            running: "running";
        }>;
        outcome: z.ZodOptional<z.ZodEnum<{
            abstained: "abstained";
            budget_exceeded: "budget_exceeded";
            completed: "completed";
            infrastructure_failure: "infrastructure_failure";
            invalid_configuration: "invalid_configuration";
            not_run: "not_run";
            protocol_failure: "protocol_failure";
            system_failure: "system_failure";
        }>>;
    }, z.core.$strict>>;
    startedAt: z.ZodISODateTime;
    completedAt: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$strict>;
/** A run. */
export type Run = z.infer<typeof Run>;
//# sourceMappingURL=run.d.ts.map