import * as z from "zod";
/**
 * Where a locked source came from. An HTTPS source whose URL the environment holds is recorded by
 * its host and path only.
 */
export declare const LockedOrigin: z.ZodXor<readonly [z.ZodObject<{
    dataset: z.ZodString;
    path: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    file: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    git: z.ZodObject<{
        repo: z.ZodString;
        commit: z.ZodString;
        path: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    https: z.ZodObject<{
        host: z.ZodString;
        path: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodArray<z.ZodString>;
    output: z.ZodString;
}, z.core.$strict>]>;
/** A case source as the lock pins it: its digest, its size and its cases per pool. */
export declare const LockedSource: z.ZodObject<{
    origin: z.ZodXor<readonly [z.ZodObject<{
        dataset: z.ZodString;
        path: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        file: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        git: z.ZodObject<{
            repo: z.ZodString;
            commit: z.ZodString;
            path: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        https: z.ZodObject<{
            host: z.ZodString;
            path: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        command: z.ZodArray<z.ZodString>;
        output: z.ZodString;
    }, z.core.$strict>]>;
    digest: z.ZodString;
    bytes: z.ZodInt;
    pools: z.ZodRecord<z.ZodEnum<{
        development: "development";
        promoted: "promoted";
        sealed: "sealed";
        validation: "validation";
    }> & z.core.$partial, z.ZodInt>;
}, z.core.$strict>;
/** A dataset as the lock pins it: its commit, and the exposure of the place where it lives. */
export declare const LockedDataset: z.ZodObject<{
    commit: z.ZodOptional<z.ZodString>;
    place: z.ZodEnum<{
        private: "private";
        public: "public";
    }>;
}, z.core.$strict>;
/** A model judge's identity, as the lock pins it. */
export declare const JudgeIdentity: z.ZodObject<{
    model: z.ZodString;
    parameters: z.ZodRecord<z.ZodString, z.ZodXor<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
    prompt: z.ZodString;
    rubric: z.ZodString;
    inputsDigest: z.ZodString;
}, z.core.$strict>;
/** An instrument's pin: the tree digest of its files, its image and its judge identity. */
export declare const InstrumentPin: z.ZodObject<{
    files: z.ZodOptional<z.ZodString>;
    image: z.ZodOptional<z.ZodObject<{
        reference: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>>;
    judge: z.ZodOptional<z.ZodObject<{
        model: z.ZodString;
        parameters: z.ZodRecord<z.ZodString, z.ZodXor<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
        prompt: z.ZodString;
        rubric: z.ZodString;
        inputsDigest: z.ZodString;
    }, z.core.$strict>>;
    imported: z.ZodOptional<z.ZodObject<{
        version: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
/**
 * The lock of a suite (`ichnaea.suite.lock/1`), written by `ichnaea lock` beside the suite. It is
 * stale when the measurement digest, a source, an instrument pin or a measure definition differs
 * from the suite and the checkout. Runtimes are not in the lock; each run's plan records them.
 */
export declare const SuiteLock: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.suite.lock/1">;
    suite: z.core.$ZodBranded<z.ZodString, "SuiteId", "out">;
    suiteDigest: z.ZodString;
    measurementDigest: z.ZodString;
    sources: z.ZodArray<z.ZodObject<{
        origin: z.ZodXor<readonly [z.ZodObject<{
            dataset: z.ZodString;
            path: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            file: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            git: z.ZodObject<{
                repo: z.ZodString;
                commit: z.ZodString;
                path: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            https: z.ZodObject<{
                host: z.ZodString;
                path: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            command: z.ZodArray<z.ZodString>;
            output: z.ZodString;
        }, z.core.$strict>]>;
        digest: z.ZodString;
        bytes: z.ZodInt;
        pools: z.ZodRecord<z.ZodEnum<{
            development: "development";
            promoted: "promoted";
            sealed: "sealed";
            validation: "validation";
        }> & z.core.$partial, z.ZodInt>;
    }, z.core.$strict>>;
    datasets: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        commit: z.ZodOptional<z.ZodString>;
        place: z.ZodEnum<{
            private: "private";
            public: "public";
        }>;
    }, z.core.$strict>>>;
    instruments: z.ZodRecord<z.ZodString, z.ZodObject<{
        files: z.ZodOptional<z.ZodString>;
        image: z.ZodOptional<z.ZodObject<{
            reference: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>>;
        judge: z.ZodOptional<z.ZodObject<{
            model: z.ZodString;
            parameters: z.ZodRecord<z.ZodString, z.ZodXor<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
            prompt: z.ZodString;
            rubric: z.ZodString;
            inputsDigest: z.ZodString;
        }, z.core.$strict>>;
        imported: z.ZodOptional<z.ZodObject<{
            version: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    measures: z.ZodRecord<z.ZodString, z.ZodString>;
    limits: z.ZodRecord<z.ZodString, z.ZodObject<{
        limit: z.ZodNumber;
        owner: z.ZodString;
        reason: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** A suite lock. */
export type SuiteLock = z.infer<typeof SuiteLock>;
//# sourceMappingURL=lock.d.ts.map