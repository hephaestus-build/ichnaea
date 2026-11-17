import * as z from "zod";
/** A purpose of processing, such as `PU-3` (human rating of real content). */
export declare const PurposeId: z.ZodString;
/**
 * Where stored baselines come from: the local store, or a successful `push` run of a named
 * workflow on the base branch of this repository.
 */
export declare const BaselineSource: z.ZodXor<readonly [z.ZodLiteral<"store">, z.ZodObject<{
    githubArtifact: z.ZodObject<{
        workflow: z.ZodString;
        branch: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>]>;
/** Stored baselines: where they come from, how old they may be, and the drift sentinel. */
export declare const Baselines: z.ZodObject<{
    from: z.ZodOptional<z.ZodXor<readonly [z.ZodLiteral<"store">, z.ZodObject<{
        githubArtifact: z.ZodObject<{
            workflow: z.ZodString;
            branch: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>]>>;
    freshness: z.ZodOptional<z.ZodString>;
    maxFreshness: z.ZodOptional<z.ZodString>;
    sentinel: z.ZodOptional<z.ZodObject<{
        share: z.ZodOptional<z.ZodNumber>;
        min: z.ZodOptional<z.ZodInt>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/**
 * A grant that lets a sink receive private content: the exposure, the purpose and the reason. No
 * sink ever receives sealed content, so `private` is the only exposure a grant can name.
 */
export declare const Clearance: z.ZodObject<{
    maxExposure: z.ZodLiteral<"private">;
    purpose: z.ZodString;
    reason: z.ZodString;
}, z.core.$strict>;
/**
 * A destination for a run's card, tagged by its kind. A local sink (`console`, `file`) and the
 * `github` sink, which uses the job's token, take no URL. Every other remote sink reads its URL
 * from the environment, and a `webhook` also signs with a key from the environment (Standard
 * Webhooks). Only a `github` sink and a `webhook` sink may take a clearance grant above class none
 * and exposure public; no grant raises a Teams, Slack or OTLP sink.
 */
export declare const SinkSettings: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"console">;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"file">;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"github">;
    clearance: z.ZodOptional<z.ZodObject<{
        maxExposure: z.ZodLiteral<"private">;
        purpose: z.ZodString;
        reason: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"teams-workflow">;
    url: z.ZodObject<{
        fromEnv: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"slack">;
    url: z.ZodObject<{
        fromEnv: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"webhook">;
    url: z.ZodObject<{
        fromEnv: z.ZodString;
    }, z.core.$strict>;
    signingKey: z.ZodObject<{
        fromEnv: z.ZodString;
    }, z.core.$strict>;
    clearance: z.ZodOptional<z.ZodObject<{
        maxExposure: z.ZodLiteral<"private">;
        purpose: z.ZodString;
        reason: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"otlp">;
    url: z.ZodObject<{
        fromEnv: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>], "kind">;
/** Which sinks receive the card of an event. */
export declare const DeliveryRoute: z.ZodObject<{
    on: z.ZodEnum<{
        attribute: "attribute";
        calibrate: "calibrate";
        compare: "compare";
        estimate: "estimate";
        monitor: "monitor";
        "monitor.alert": "monitor.alert";
        noise: "noise";
    }>;
    profile: z.ZodOptional<z.ZodString>;
    to: z.ZodArray<z.ZodString>;
    required: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
/** One purpose of processing that the home enables, with its legal basis and its record. */
export declare const PurposeGrant: z.ZodObject<{
    enabled: z.ZodBoolean;
    basis: z.ZodEnum<{
        consent: "consent";
        "public-task": "public-task";
    }>;
    record: z.ZodString;
}, z.core.$strict>;
/** A model endpoint that the home registers for content above class none. */
export declare const GovernedEndpoint: z.ZodObject<{
    provider: z.ZodString;
    region: z.ZodString;
    purposes: z.ZodArray<z.ZodString>;
    trainsOnInputs: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
/** The governance of data above class none. It belongs in the home project config only. */
export declare const Governance: z.ZodObject<{
    home: z.ZodObject<{
        description: z.ZodString;
    }, z.core.$strict>;
    purposes: z.ZodRecord<z.ZodString, z.ZodObject<{
        enabled: z.ZodBoolean;
        basis: z.ZodEnum<{
            consent: "consent";
            "public-task": "public-task";
        }>;
        record: z.ZodString;
    }, z.core.$strict>>;
    endpoints: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        provider: z.ZodString;
        region: z.ZodString;
        purposes: z.ZodArray<z.ZodString>;
        trainsOnInputs: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>>;
    retention: z.ZodOptional<z.ZodObject<{
        pseudonymous: z.ZodOptional<z.ZodString>;
        personal: z.ZodOptional<z.ZodString>;
        labels: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/**
 * The project config (`ichnaea.project/1`): what several suites share, as plain JSON data. It is the
 * canonical form of an `ichnaea.config.ts` or `ichnaea.config.jsonc` file.
 */
export declare const ProjectConfig: z.ZodObject<{
    $schema: z.ZodOptional<z.ZodString>;
    schema: z.ZodLiteral<"ichnaea.project/1">;
    suites: z.ZodOptional<z.ZodArray<z.ZodString>>;
    datasets: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodXor<readonly [z.ZodObject<{
        file: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        git: z.ZodObject<{
            repo: z.ZodString;
            commit: z.ZodString;
            path: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        https: z.ZodXor<readonly [z.ZodObject<{
            url: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            fromEnv: z.ZodString;
        }, z.core.$strict>]>;
        digest: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        command: z.ZodArray<z.ZodString>;
        output: z.ZodString;
        env: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>]>>>;
    workers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        command: z.ZodArray<z.ZodString>;
        prepare: z.ZodOptional<z.ZodArray<z.ZodString>>;
        env: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            secret: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>>>;
        envFile: z.ZodOptional<z.ZodString>;
        endpoints: z.ZodOptional<z.ZodArray<z.ZodString>>;
        capacity: z.ZodOptional<z.ZodInt>;
        processes: z.ZodOptional<z.ZodInt>;
        startTimeout: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>;
    endpoints: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        provider: z.ZodOptional<z.ZodString>;
        region: z.ZodOptional<z.ZodString>;
        concurrency: z.ZodOptional<z.ZodInt>;
        requestsPerMinute: z.ZodOptional<z.ZodInt>;
        tokensPerMinute: z.ZodOptional<z.ZodInt>;
    }, z.core.$strict>>>;
    store: z.ZodOptional<z.ZodObject<{
        path: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    baselines: z.ZodOptional<z.ZodObject<{
        from: z.ZodOptional<z.ZodXor<readonly [z.ZodLiteral<"store">, z.ZodObject<{
            githubArtifact: z.ZodObject<{
                workflow: z.ZodString;
                branch: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>]>>;
        freshness: z.ZodOptional<z.ZodString>;
        maxFreshness: z.ZodOptional<z.ZodString>;
        sentinel: z.ZodOptional<z.ZodObject<{
            share: z.ZodOptional<z.ZodNumber>;
            min: z.ZodOptional<z.ZodInt>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    defaults: z.ZodOptional<z.ZodObject<{
        trials: z.ZodOptional<z.ZodInt>;
        mode: z.ZodOptional<z.ZodEnum<{
            confirm: "confirm";
            fast: "fast";
        }>>;
        profile: z.ZodOptional<z.ZodString>;
        limits: z.ZodOptional<z.ZodObject<{
            artifactBytes: z.ZodOptional<z.ZodInt>;
            outputBytes: z.ZodOptional<z.ZodInt>;
            trialDeadline: z.ZodOptional<z.ZodString>;
            wallClockMax: z.ZodOptional<z.ZodString>;
            missingMax: z.ZodOptional<z.ZodNumber>;
            throttleMax: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    delivery: z.ZodOptional<z.ZodObject<{
        sinks: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"console">;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"file">;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"github">;
            clearance: z.ZodOptional<z.ZodObject<{
                maxExposure: z.ZodLiteral<"private">;
                purpose: z.ZodString;
                reason: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"teams-workflow">;
            url: z.ZodObject<{
                fromEnv: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"slack">;
            url: z.ZodObject<{
                fromEnv: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"webhook">;
            url: z.ZodObject<{
                fromEnv: z.ZodString;
            }, z.core.$strict>;
            signingKey: z.ZodObject<{
                fromEnv: z.ZodString;
            }, z.core.$strict>;
            clearance: z.ZodOptional<z.ZodObject<{
                maxExposure: z.ZodLiteral<"private">;
                purpose: z.ZodString;
                reason: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"otlp">;
            url: z.ZodObject<{
                fromEnv: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>], "kind">>>;
        routes: z.ZodOptional<z.ZodArray<z.ZodObject<{
            on: z.ZodEnum<{
                attribute: "attribute";
                calibrate: "calibrate";
                compare: "compare";
                estimate: "estimate";
                monitor: "monitor";
                "monitor.alert": "monitor.alert";
                noise: "noise";
            }>;
            profile: z.ZodOptional<z.ZodString>;
            to: z.ZodArray<z.ZodString>;
            required: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>>>;
    }, z.core.$strict>>;
    history: z.ZodOptional<z.ZodArray<z.ZodString>>;
    privacy: z.ZodOptional<z.ZodObject<{
        homeKey: z.ZodOptional<z.ZodObject<{
            fromEnv: z.ZodString;
        }, z.core.$strict>>;
        consent: z.ZodOptional<z.ZodString>;
        governance: z.ZodOptional<z.ZodObject<{
            home: z.ZodObject<{
                description: z.ZodString;
            }, z.core.$strict>;
            purposes: z.ZodRecord<z.ZodString, z.ZodObject<{
                enabled: z.ZodBoolean;
                basis: z.ZodEnum<{
                    consent: "consent";
                    "public-task": "public-task";
                }>;
                record: z.ZodString;
            }, z.core.$strict>>;
            endpoints: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
                provider: z.ZodString;
                region: z.ZodString;
                purposes: z.ZodArray<z.ZodString>;
                trainsOnInputs: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>>>;
            retention: z.ZodOptional<z.ZodObject<{
                pseudonymous: z.ZodOptional<z.ZodString>;
                personal: z.ZodOptional<z.ZodString>;
                labels: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** A project config. */
export type ProjectConfig = z.infer<typeof ProjectConfig>;
//# sourceMappingURL=project.d.ts.map