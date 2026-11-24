import * as z from "zod";
/** How a case entered its case set. Decides which estimand it supports. */
export declare const CaseSelection: z.ZodEnum<{
    curated: "curated";
    generated: "generated";
    promoted: "promoted";
    random: "random";
}>;
/** A pool: a part of a case set with an exposure rule. */
export declare const Pool: z.ZodEnum<{
    development: "development";
    promoted: "promoted";
    sealed: "sealed";
    validation: "validation";
}>;
/** A pool. */
export type Pool = z.infer<typeof Pool>;
/**
 * Where a case came from (REQ-08). The source decides what must be recorded: a reused dataset
 * names the dataset and its limits, a generated case names its generator, a collected case its
 * collection date, a promoted case the finding it came from.
 */
export declare const CaseProvenance: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
}, z.core.$strict>], "source">;
/** One scripted turn of a session case. */
export declare const ScriptedTurn: z.ZodObject<{
    role: z.ZodEnum<{
        assistant: "assistant";
        system: "system";
        tool: "tool";
        user: "user";
    }>;
    content: z.ZodJSONSchema;
}, z.core.$strict>;
/** One evaluation input with its fixtures and hidden references (REQ-08, REQ-09). */
export declare const Case: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.case/1">;
    id: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
    caseSet: z.ZodOptional<z.core.$ZodBranded<z.ZodString, "CaseSetId", "out">>;
    unit: z.ZodEnum<{
        episode: "episode";
        session: "session";
        trace: "trace";
        turn: "turn";
    }>;
    dataClass: z.ZodEnum<{
        none: "none";
        personal: "personal";
        pseudonymous: "pseudonymous";
        special: "special";
    }>;
    input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    turns: z.ZodOptional<z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<{
            assistant: "assistant";
            system: "system";
            tool: "tool";
            user: "user";
        }>;
        content: z.ZodJSONSchema;
    }, z.core.$strict>>>;
    fixtures: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        digest: z.ZodString;
        uri: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>;
    references: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    family: z.ZodOptional<z.ZodString>;
    slices: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    criticality: z.ZodOptional<z.ZodEnum<{
        critical: "critical";
        high: "high";
        low: "low";
        normal: "normal";
    }>>;
    provenance: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "source">;
    pool: z.ZodEnum<{
        development: "development";
        promoted: "promoted";
        sealed: "sealed";
        validation: "validation";
    }>;
    validation: z.ZodOptional<z.ZodObject<{
        status: z.ZodEnum<{
            draft: "draft";
            reviewed: "reviewed";
            suspect: "suspect";
            validated: "validated";
        }>;
        note: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** A case. */
export type Case = z.infer<typeof Case>;
/** One entry of a case set manifest. */
export declare const CaseSetEntry: z.ZodObject<{
    id: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
    digest: z.ZodString;
    pool: z.ZodEnum<{
        development: "development";
        promoted: "promoted";
        sealed: "sealed";
        validation: "validation";
    }>;
    family: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** A versioned collection of cases, identified by the digest of its entries (REQ-10). */
export declare const CaseSet: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.caseSet/1">;
    id: z.core.$ZodBranded<z.ZodString, "CaseSetId", "out">;
    version: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    digest: z.ZodString;
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
    applicability: z.ZodOptional<z.ZodRecord<z.core.$ZodBranded<z.ZodString, "MeasureId", "out">, z.ZodArray<z.core.$ZodBranded<z.ZodString, "CaseId", "out">>>>;
}, z.core.$strict>;
/** A case set. */
export type CaseSet = z.infer<typeof CaseSet>;
//# sourceMappingURL=case.d.ts.map