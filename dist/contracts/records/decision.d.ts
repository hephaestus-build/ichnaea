import * as z from "zod";
/** A run verdict (REQ-53). */
export declare const Verdict: z.ZodEnum<{
    INCONCLUSIVE: "INCONCLUSIVE";
    INVALID: "INVALID";
    PASS: "PASS";
    REGRESSION: "REGRESSION";
}>;
/** A run verdict. */
export type Verdict = z.infer<typeof Verdict>;
/** A verdict for one primary measure. */
export declare const MeasureVerdict: z.ZodEnum<{
    "ESTIMATE-ONLY": "ESTIMATE-ONLY";
    INCONCLUSIVE: "INCONCLUSIVE";
    "NON-INFERIOR": "NON-INFERIOR";
    REGRESSION: "REGRESSION";
}>;
/** Counts behind a rate, with not-applicable and missing kept apart (REQ-30). */
export declare const Availability: z.ZodObject<{
    planned: z.ZodInt;
    available: z.ZodInt;
    notApplicable: z.ZodInt;
    missing: z.ZodInt;
}, z.core.$strict>;
/** An estimate with its interval and method. */
export declare const Estimate: z.ZodObject<{
    estimate: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
        nonFinite: z.ZodEnum<{
            "-inf": "-inf";
            inf: "inf";
            nan: "nan";
        }>;
    }, z.core.$strict>]>;
    lower: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
        nonFinite: z.ZodEnum<{
            "-inf": "-inf";
            inf: "inf";
            nan: "nan";
        }>;
    }, z.core.$strict>]>;
    upper: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
        nonFinite: z.ZodEnum<{
            "-inf": "-inf";
            inf: "inf";
            nan: "nan";
        }>;
    }, z.core.$strict>]>;
    level: z.ZodNumber;
    sided: z.ZodEnum<{
        lower: "lower";
        two: "two";
        upper: "upper";
    }>;
    method: z.ZodString;
}, z.core.$strict>;
/** A case whose binary outcome changed between two arms (REQ-52). Rates are per-case pass rates. */
export declare const Flip: z.ZodObject<{
    case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
    direction: z.ZodEnum<{
        negative: "negative";
        positive: "positive";
    }>;
    base: z.ZodNumber;
    candidate: z.ZodNumber;
}, z.core.$strict>;
/**
 * Whether one result of a comparison lies inside the validated domain of its method, and why not
 * (decision 0015). A result that is not validated names at least one reason.
 */
export declare const Validity: z.ZodDiscriminatedUnion<[z.ZodObject<{
    validated: z.ZodLiteral<true>;
    limitations: z.ZodArray<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    validated: z.ZodLiteral<false>;
    limitations: z.ZodArray<z.ZodString>;
}, z.core.$strict>], "validated">;
/** One arm's estimate for a measure. */
export declare const ArmEstimate: z.ZodObject<{
    arm: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
    rate: z.ZodObject<{
        estimate: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
            nonFinite: z.ZodEnum<{
                "-inf": "-inf";
                inf: "inf";
                nan: "nan";
            }>;
        }, z.core.$strict>]>;
        lower: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
            nonFinite: z.ZodEnum<{
                "-inf": "-inf";
                inf: "inf";
                nan: "nan";
            }>;
        }, z.core.$strict>]>;
        upper: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
            nonFinite: z.ZodEnum<{
                "-inf": "-inf";
                inf: "inf";
                nan: "nan";
            }>;
        }, z.core.$strict>]>;
        level: z.ZodNumber;
        sided: z.ZodEnum<{
            lower: "lower";
            two: "two";
            upper: "upper";
        }>;
        method: z.ZodString;
    }, z.core.$strict>;
    availability: z.ZodObject<{
        planned: z.ZodInt;
        available: z.ZodInt;
        notApplicable: z.ZodInt;
        missing: z.ZodInt;
    }, z.core.$strict>;
    caseAvailability: z.ZodOptional<z.ZodObject<{
        planned: z.ZodInt;
        observed: z.ZodInt;
    }, z.core.$strict>>;
    intervalValidity: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        validated: z.ZodLiteral<true>;
        limitations: z.ZodArray<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        validated: z.ZodLiteral<false>;
        limitations: z.ZodArray<z.ZodString>;
    }, z.core.$strict>], "validated">>;
}, z.core.$strict>;
/** The comparison of one candidate with the base for one measure. None in estimate-only mode. */
export declare const Comparison: z.ZodObject<{
    base: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
    candidate: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
    difference: z.ZodObject<{
        estimate: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
            nonFinite: z.ZodEnum<{
                "-inf": "-inf";
                inf: "inf";
                nan: "nan";
            }>;
        }, z.core.$strict>]>;
        lower: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
            nonFinite: z.ZodEnum<{
                "-inf": "-inf";
                inf: "inf";
                nan: "nan";
            }>;
        }, z.core.$strict>]>;
        upper: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
            nonFinite: z.ZodEnum<{
                "-inf": "-inf";
                inf: "inf";
                nan: "nan";
            }>;
        }, z.core.$strict>]>;
        level: z.ZodNumber;
        sided: z.ZodEnum<{
            lower: "lower";
            two: "two";
            upper: "upper";
        }>;
        method: z.ZodString;
    }, z.core.$strict>;
    margin: z.ZodNumber;
    safetyMargin: z.ZodNumber;
    nonInferiorityP: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
        nonFinite: z.ZodEnum<{
            "-inf": "-inf";
            inf: "inf";
            nan: "nan";
        }>;
    }, z.core.$strict>]>;
    regressionP: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
        nonFinite: z.ZodEnum<{
            "-inf": "-inf";
            inf: "inf";
            nan: "nan";
        }>;
    }, z.core.$strict>]>;
    regressionPAdjusted: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
        nonFinite: z.ZodEnum<{
            "-inf": "-inf";
            inf: "inf";
            nan: "nan";
        }>;
    }, z.core.$strict>]>;
    regressionMethod: z.ZodString;
    regression: z.ZodDiscriminatedUnion<[z.ZodObject<{
        validated: z.ZodLiteral<true>;
        limitations: z.ZodArray<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        validated: z.ZodLiteral<false>;
        limitations: z.ZodArray<z.ZodString>;
    }, z.core.$strict>], "validated">;
    nonInferiority: z.ZodDiscriminatedUnion<[z.ZodObject<{
        validated: z.ZodLiteral<true>;
        limitations: z.ZodArray<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        validated: z.ZodLiteral<false>;
        limitations: z.ZodArray<z.ZodString>;
    }, z.core.$strict>], "validated">;
    randomized: z.ZodOptional<z.ZodObject<{
        withinP: z.ZodNumber;
        withinPAdjusted: z.ZodNumber;
        blockLower: z.ZodNumber;
        withinLower: z.ZodNumber;
        pairs: z.ZodInt;
        imputedTrials: z.ZodInt;
    }, z.core.$strict>>;
    flips: z.ZodArray<z.ZodObject<{
        case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
        direction: z.ZodEnum<{
            negative: "negative";
            positive: "positive";
        }>;
        base: z.ZodNumber;
        candidate: z.ZodNumber;
    }, z.core.$strict>>;
}, z.core.$strict>;
/**
 * One imputation of the sensitivity analysis for missing trials (REQ-56): the measure decided
 * again with its missing trials imputed against one verdict. Against non-inferiority, missing
 * candidate trials fail and missing base trials pass; against regression, the reverse.
 */
export declare const SensitivityResult: z.ZodObject<{
    imputation: z.ZodEnum<{
        "against-non-inferiority": "against-non-inferiority";
        "against-regression": "against-regression";
    }>;
    difference: z.ZodObject<{
        estimate: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
            nonFinite: z.ZodEnum<{
                "-inf": "-inf";
                inf: "inf";
                nan: "nan";
            }>;
        }, z.core.$strict>]>;
        lower: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
            nonFinite: z.ZodEnum<{
                "-inf": "-inf";
                inf: "inf";
                nan: "nan";
            }>;
        }, z.core.$strict>]>;
        upper: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
            nonFinite: z.ZodEnum<{
                "-inf": "-inf";
                inf: "inf";
                nan: "nan";
            }>;
        }, z.core.$strict>]>;
        level: z.ZodNumber;
        sided: z.ZodEnum<{
            lower: "lower";
            two: "two";
            upper: "upper";
        }>;
        method: z.ZodString;
    }, z.core.$strict>;
    nonInferiorityP: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
        nonFinite: z.ZodEnum<{
            "-inf": "-inf";
            inf: "inf";
            nan: "nan";
        }>;
    }, z.core.$strict>]>;
    regressionPAdjusted: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
        nonFinite: z.ZodEnum<{
            "-inf": "-inf";
            inf: "inf";
            nan: "nan";
        }>;
    }, z.core.$strict>]>;
    regression: z.ZodDiscriminatedUnion<[z.ZodObject<{
        validated: z.ZodLiteral<true>;
        limitations: z.ZodArray<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        validated: z.ZodLiteral<false>;
        limitations: z.ZodArray<z.ZodString>;
    }, z.core.$strict>], "validated">;
    nonInferiority: z.ZodDiscriminatedUnion<[z.ZodObject<{
        validated: z.ZodLiteral<true>;
        limitations: z.ZodArray<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        validated: z.ZodLiteral<false>;
        limitations: z.ZodArray<z.ZodString>;
    }, z.core.$strict>], "validated">;
    verdict: z.ZodEnum<{
        "ESTIMATE-ONLY": "ESTIMATE-ONLY";
        INCONCLUSIVE: "INCONCLUSIVE";
        "NON-INFERIOR": "NON-INFERIOR";
        REGRESSION: "REGRESSION";
    }>;
    changesVerdict: z.ZodBoolean;
}, z.core.$strict>;
/** The result for one primary or secondary measure. */
export declare const MeasureOutcome: z.ZodObject<{
    measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    version: z.ZodString;
    tier: z.ZodEnum<{
        primary: "primary";
        secondary: "secondary";
    }>;
    estimand: z.ZodEnum<{
        "fixed-cases": "fixed-cases";
        "sampled-cases": "sampled-cases";
    }>;
    arms: z.ZodArray<z.ZodObject<{
        arm: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
        rate: z.ZodObject<{
            estimate: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                nonFinite: z.ZodEnum<{
                    "-inf": "-inf";
                    inf: "inf";
                    nan: "nan";
                }>;
            }, z.core.$strict>]>;
            lower: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                nonFinite: z.ZodEnum<{
                    "-inf": "-inf";
                    inf: "inf";
                    nan: "nan";
                }>;
            }, z.core.$strict>]>;
            upper: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                nonFinite: z.ZodEnum<{
                    "-inf": "-inf";
                    inf: "inf";
                    nan: "nan";
                }>;
            }, z.core.$strict>]>;
            level: z.ZodNumber;
            sided: z.ZodEnum<{
                lower: "lower";
                two: "two";
                upper: "upper";
            }>;
            method: z.ZodString;
        }, z.core.$strict>;
        availability: z.ZodObject<{
            planned: z.ZodInt;
            available: z.ZodInt;
            notApplicable: z.ZodInt;
            missing: z.ZodInt;
        }, z.core.$strict>;
        caseAvailability: z.ZodOptional<z.ZodObject<{
            planned: z.ZodInt;
            observed: z.ZodInt;
        }, z.core.$strict>>;
        intervalValidity: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
            validated: z.ZodLiteral<true>;
            limitations: z.ZodArray<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            validated: z.ZodLiteral<false>;
            limitations: z.ZodArray<z.ZodString>;
        }, z.core.$strict>], "validated">>;
    }, z.core.$strict>>;
    comparisons: z.ZodArray<z.ZodObject<{
        base: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
        candidate: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
        difference: z.ZodObject<{
            estimate: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                nonFinite: z.ZodEnum<{
                    "-inf": "-inf";
                    inf: "inf";
                    nan: "nan";
                }>;
            }, z.core.$strict>]>;
            lower: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                nonFinite: z.ZodEnum<{
                    "-inf": "-inf";
                    inf: "inf";
                    nan: "nan";
                }>;
            }, z.core.$strict>]>;
            upper: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                nonFinite: z.ZodEnum<{
                    "-inf": "-inf";
                    inf: "inf";
                    nan: "nan";
                }>;
            }, z.core.$strict>]>;
            level: z.ZodNumber;
            sided: z.ZodEnum<{
                lower: "lower";
                two: "two";
                upper: "upper";
            }>;
            method: z.ZodString;
        }, z.core.$strict>;
        margin: z.ZodNumber;
        safetyMargin: z.ZodNumber;
        nonInferiorityP: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
            nonFinite: z.ZodEnum<{
                "-inf": "-inf";
                inf: "inf";
                nan: "nan";
            }>;
        }, z.core.$strict>]>;
        regressionP: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
            nonFinite: z.ZodEnum<{
                "-inf": "-inf";
                inf: "inf";
                nan: "nan";
            }>;
        }, z.core.$strict>]>;
        regressionPAdjusted: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
            nonFinite: z.ZodEnum<{
                "-inf": "-inf";
                inf: "inf";
                nan: "nan";
            }>;
        }, z.core.$strict>]>;
        regressionMethod: z.ZodString;
        regression: z.ZodDiscriminatedUnion<[z.ZodObject<{
            validated: z.ZodLiteral<true>;
            limitations: z.ZodArray<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            validated: z.ZodLiteral<false>;
            limitations: z.ZodArray<z.ZodString>;
        }, z.core.$strict>], "validated">;
        nonInferiority: z.ZodDiscriminatedUnion<[z.ZodObject<{
            validated: z.ZodLiteral<true>;
            limitations: z.ZodArray<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            validated: z.ZodLiteral<false>;
            limitations: z.ZodArray<z.ZodString>;
        }, z.core.$strict>], "validated">;
        randomized: z.ZodOptional<z.ZodObject<{
            withinP: z.ZodNumber;
            withinPAdjusted: z.ZodNumber;
            blockLower: z.ZodNumber;
            withinLower: z.ZodNumber;
            pairs: z.ZodInt;
            imputedTrials: z.ZodInt;
        }, z.core.$strict>>;
        flips: z.ZodArray<z.ZodObject<{
            case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
            direction: z.ZodEnum<{
                negative: "negative";
                positive: "positive";
            }>;
            base: z.ZodNumber;
            candidate: z.ZodNumber;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    verdict: z.ZodEnum<{
        "ESTIMATE-ONLY": "ESTIMATE-ONLY";
        INCONCLUSIVE: "INCONCLUSIVE";
        "NON-INFERIOR": "NON-INFERIOR";
        REGRESSION: "REGRESSION";
    }>;
    coverage: z.ZodNumber;
    blocks: z.ZodOptional<z.ZodObject<{
        planned: z.ZodInt;
        observed: z.ZodInt;
        effective: z.ZodNullable<z.ZodInt>;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    noise: z.ZodOptional<z.ZodObject<{
        arms: z.ZodArray<z.ZodObject<{
            arm: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
            withinCaseVariance: z.ZodNullable<z.ZodNumber>;
            replicatedCells: z.ZodInt;
            caseDispersion: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>>;
        betweenBlockVariance: z.ZodNullable<z.ZodNumber>;
        contrastBlocks: z.ZodInt;
    }, z.core.$strict>>;
    sensitivity: z.ZodArray<z.ZodObject<{
        imputation: z.ZodEnum<{
            "against-non-inferiority": "against-non-inferiority";
            "against-regression": "against-regression";
        }>;
        difference: z.ZodObject<{
            estimate: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                nonFinite: z.ZodEnum<{
                    "-inf": "-inf";
                    inf: "inf";
                    nan: "nan";
                }>;
            }, z.core.$strict>]>;
            lower: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                nonFinite: z.ZodEnum<{
                    "-inf": "-inf";
                    inf: "inf";
                    nan: "nan";
                }>;
            }, z.core.$strict>]>;
            upper: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                nonFinite: z.ZodEnum<{
                    "-inf": "-inf";
                    inf: "inf";
                    nan: "nan";
                }>;
            }, z.core.$strict>]>;
            level: z.ZodNumber;
            sided: z.ZodEnum<{
                lower: "lower";
                two: "two";
                upper: "upper";
            }>;
            method: z.ZodString;
        }, z.core.$strict>;
        nonInferiorityP: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
            nonFinite: z.ZodEnum<{
                "-inf": "-inf";
                inf: "inf";
                nan: "nan";
            }>;
        }, z.core.$strict>]>;
        regressionPAdjusted: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
            nonFinite: z.ZodEnum<{
                "-inf": "-inf";
                inf: "inf";
                nan: "nan";
            }>;
        }, z.core.$strict>]>;
        regression: z.ZodDiscriminatedUnion<[z.ZodObject<{
            validated: z.ZodLiteral<true>;
            limitations: z.ZodArray<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            validated: z.ZodLiteral<false>;
            limitations: z.ZodArray<z.ZodString>;
        }, z.core.$strict>], "validated">;
        nonInferiority: z.ZodDiscriminatedUnion<[z.ZodObject<{
            validated: z.ZodLiteral<true>;
            limitations: z.ZodArray<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            validated: z.ZodLiteral<false>;
            limitations: z.ZodArray<z.ZodString>;
        }, z.core.$strict>], "validated">;
        verdict: z.ZodEnum<{
            "ESTIMATE-ONLY": "ESTIMATE-ONLY";
            INCONCLUSIVE: "INCONCLUSIVE";
            "NON-INFERIOR": "NON-INFERIOR";
            REGRESSION: "REGRESSION";
        }>;
        changesVerdict: z.ZodBoolean;
    }, z.core.$strict>>;
    notes: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
/** The result of one hard gate. */
export declare const GateResult: z.ZodObject<{
    gate: z.core.$ZodBranded<z.ZodString, "GateId", "out">;
    passed: z.ZodBoolean;
    failures: z.ZodInt;
    detail: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** A hard-gate result. */
export type GateResult = z.infer<typeof GateResult>;
/** The comparison of missing trials between arms (REQ-56). */
export declare const Missingness: z.ZodObject<{
    byArm: z.ZodArray<z.ZodObject<{
        arm: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
        missing: z.ZodInt;
        planned: z.ZodInt;
    }, z.core.$strict>>;
    differs: z.ZodBoolean;
    sensitivity: z.ZodEnum<{
        "adverse-completion": "adverse-completion";
        "changes-verdict": "changes-verdict";
        "not-needed": "not-needed";
        unchanged: "unchanged";
    }>;
}, z.core.$strict>;
/** The verdict of one run with estimates, intervals, flips and lineage (REQ-49 to REQ-56). */
export declare const Decision: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.decision/1">;
    mode: z.ZodEnum<{
        decision: "decision";
        "estimate-only": "estimate-only";
    }>;
    verdict: z.ZodNullable<z.ZodEnum<{
        INCONCLUSIVE: "INCONCLUSIVE";
        INVALID: "INVALID";
        PASS: "PASS";
        REGRESSION: "REGRESSION";
    }>>;
    reason: z.ZodString;
    reasonCode: z.ZodOptional<z.ZodEnum<{
        AGE_EXPIRED: "AGE_EXPIRED";
        ANSWER_LENGTH_OUTSIDE: "ANSWER_LENGTH_OUTSIDE";
        ARMS_NOT_INTERLEAVED: "ARMS_NOT_INTERLEAVED";
        ARM_BIAS_NOT_SHOWN_SMALL: "ARM_BIAS_NOT_SHOWN_SMALL";
        ATTENTION_FAILED: "ATTENTION_FAILED";
        DROP_IN_THESE_RUNS_ONLY: "DROP_IN_THESE_RUNS_ONLY";
        ESTIMATE_ONLY_CACHED_ARM: "ESTIMATE_ONLY_CACHED_ARM";
        ESTIMATE_ONLY_EXPLORATORY: "ESTIMATE_ONLY_EXPLORATORY";
        ESTIMATE_ONLY_FEW_CASES: "ESTIMATE_ONLY_FEW_CASES";
        ESTIMATE_ONLY_NO_COMPARISON: "ESTIMATE_ONLY_NO_COMPARISON";
        ESTIMATE_ONLY_NO_METHOD: "ESTIMATE_ONLY_NO_METHOD";
        ESTIMATE_ONLY_NO_PRIMARY: "ESTIMATE_ONLY_NO_PRIMARY";
        ESTIMATE_ONLY_PLACEHOLDER_MARGIN: "ESTIMATE_ONLY_PLACEHOLDER_MARGIN";
        ESTIMATE_ONLY_SAMPLED_CASES: "ESTIMATE_ONLY_SAMPLED_CASES";
        ESTIMATE_ONLY_SINGLE_TRIAL: "ESTIMATE_ONLY_SINGLE_TRIAL";
        EXECUTION_UNRECORDED: "EXECUTION_UNRECORDED";
        HARD_CHECK_FAILED: "HARD_CHECK_FAILED";
        INPUTS_CHANGED: "INPUTS_CHANGED";
        INTERVAL_UNAVAILABLE_DESCRIPTIVE: "INTERVAL_UNAVAILABLE_DESCRIPTIVE";
        INTERVAL_UNAVAILABLE_METHOD: "INTERVAL_UNAVAILABLE_METHOD";
        INTERVAL_UNAVAILABLE_NO_METHOD: "INTERVAL_UNAVAILABLE_NO_METHOD";
        INTERVAL_UNAVAILABLE_NO_VALUE: "INTERVAL_UNAVAILABLE_NO_VALUE";
        INVALID_BUDGET: "INVALID_BUDGET";
        INVALID_COVERAGE: "INVALID_COVERAGE";
        INVALID_HARD_CHECK_MISSING: "INVALID_HARD_CHECK_MISSING";
        INVALID_NO_BASE_RESULTS: "INVALID_NO_BASE_RESULTS";
        INVALID_RECORDS_CONTRADICT: "INVALID_RECORDS_CONTRADICT";
        INVALID_RECORDS_MISMATCH: "INVALID_RECORDS_MISMATCH";
        INVALID_SUITE_SETUP: "INVALID_SUITE_SETUP";
        INVALID_UNDECLARED_CHANGE: "INVALID_UNDECLARED_CHANGE";
        JUDGE_ARM_BIAS_WITHIN_BOUND: "JUDGE_ARM_BIAS_WITHIN_BOUND";
        JUDGE_BELOW_RATERS: "JUDGE_BELOW_RATERS";
        JUDGE_CALIBRATION_EXPIRED: "JUDGE_CALIBRATION_EXPIRED";
        JUDGE_CHANGED: "JUDGE_CHANGED";
        JUDGE_DIAGNOSTIC: "JUDGE_DIAGNOSTIC";
        JUDGE_MODEL_NOT_COVERED: "JUDGE_MODEL_NOT_COVERED";
        JUDGE_NOT_COVERED: "JUDGE_NOT_COVERED";
        MARGIN_NOT_CLEARED: "MARGIN_NOT_CLEARED";
        MARGIN_UNREACHABLE: "MARGIN_UNREACHABLE";
        MISSING_TRIALS_CHANGE_VERDICT: "MISSING_TRIALS_CHANGE_VERDICT";
        NON_INFERIORITY_UNVALIDATED: "NON_INFERIORITY_UNVALIDATED";
        NO_DECREASE_DETECTED: "NO_DECREASE_DETECTED";
        PASS: "PASS";
        POPULATION_NOT_COVERED: "POPULATION_NOT_COVERED";
        PROBE_FAILED: "PROBE_FAILED";
        RATERS_BELOW_FLOOR: "RATERS_BELOW_FLOOR";
        REGRESSION_DETECTED: "REGRESSION_DETECTED";
        REGRESSION_TEST_UNVALIDATED: "REGRESSION_TEST_UNVALIDATED";
        RUBRIC_CHANGED: "RUBRIC_CHANGED";
        SYSTEM_MODEL_NOT_COVERED: "SYSTEM_MODEL_NOT_COVERED";
        TOO_FEW_BLOCKS: "TOO_FEW_BLOCKS";
    }>>;
    withinRunDrop: z.ZodOptional<z.ZodBoolean>;
    cause: z.ZodOptional<z.ZodEnum<{
        gate: "gate";
        statistical: "statistical";
    }>>;
    scope: z.ZodString;
    plan: z.core.$ZodBranded<z.ZodString, "PlanDigest", "out">;
    run: z.core.$ZodBranded<z.ZodString, "RunId", "out">;
    runDigest: z.ZodString;
    arms: z.ZodArray<z.ZodObject<{
        name: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
        role: z.ZodEnum<{
            base: "base";
            candidate: "candidate";
            reference: "reference";
        }>;
        identity: z.core.$ZodBranded<z.ZodString, "ConfigurationIdentity", "out">;
    }, z.core.$strict>>;
    differingFactors: z.ZodArray<z.ZodString>;
    alpha: z.ZodNumber;
    measures: z.ZodArray<z.ZodObject<{
        measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
        version: z.ZodString;
        tier: z.ZodEnum<{
            primary: "primary";
            secondary: "secondary";
        }>;
        estimand: z.ZodEnum<{
            "fixed-cases": "fixed-cases";
            "sampled-cases": "sampled-cases";
        }>;
        arms: z.ZodArray<z.ZodObject<{
            arm: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
            rate: z.ZodObject<{
                estimate: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                    nonFinite: z.ZodEnum<{
                        "-inf": "-inf";
                        inf: "inf";
                        nan: "nan";
                    }>;
                }, z.core.$strict>]>;
                lower: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                    nonFinite: z.ZodEnum<{
                        "-inf": "-inf";
                        inf: "inf";
                        nan: "nan";
                    }>;
                }, z.core.$strict>]>;
                upper: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                    nonFinite: z.ZodEnum<{
                        "-inf": "-inf";
                        inf: "inf";
                        nan: "nan";
                    }>;
                }, z.core.$strict>]>;
                level: z.ZodNumber;
                sided: z.ZodEnum<{
                    lower: "lower";
                    two: "two";
                    upper: "upper";
                }>;
                method: z.ZodString;
            }, z.core.$strict>;
            availability: z.ZodObject<{
                planned: z.ZodInt;
                available: z.ZodInt;
                notApplicable: z.ZodInt;
                missing: z.ZodInt;
            }, z.core.$strict>;
            caseAvailability: z.ZodOptional<z.ZodObject<{
                planned: z.ZodInt;
                observed: z.ZodInt;
            }, z.core.$strict>>;
            intervalValidity: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                validated: z.ZodLiteral<true>;
                limitations: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                validated: z.ZodLiteral<false>;
                limitations: z.ZodArray<z.ZodString>;
            }, z.core.$strict>], "validated">>;
        }, z.core.$strict>>;
        comparisons: z.ZodArray<z.ZodObject<{
            base: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
            candidate: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
            difference: z.ZodObject<{
                estimate: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                    nonFinite: z.ZodEnum<{
                        "-inf": "-inf";
                        inf: "inf";
                        nan: "nan";
                    }>;
                }, z.core.$strict>]>;
                lower: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                    nonFinite: z.ZodEnum<{
                        "-inf": "-inf";
                        inf: "inf";
                        nan: "nan";
                    }>;
                }, z.core.$strict>]>;
                upper: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                    nonFinite: z.ZodEnum<{
                        "-inf": "-inf";
                        inf: "inf";
                        nan: "nan";
                    }>;
                }, z.core.$strict>]>;
                level: z.ZodNumber;
                sided: z.ZodEnum<{
                    lower: "lower";
                    two: "two";
                    upper: "upper";
                }>;
                method: z.ZodString;
            }, z.core.$strict>;
            margin: z.ZodNumber;
            safetyMargin: z.ZodNumber;
            nonInferiorityP: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                nonFinite: z.ZodEnum<{
                    "-inf": "-inf";
                    inf: "inf";
                    nan: "nan";
                }>;
            }, z.core.$strict>]>;
            regressionP: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                nonFinite: z.ZodEnum<{
                    "-inf": "-inf";
                    inf: "inf";
                    nan: "nan";
                }>;
            }, z.core.$strict>]>;
            regressionPAdjusted: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                nonFinite: z.ZodEnum<{
                    "-inf": "-inf";
                    inf: "inf";
                    nan: "nan";
                }>;
            }, z.core.$strict>]>;
            regressionMethod: z.ZodString;
            regression: z.ZodDiscriminatedUnion<[z.ZodObject<{
                validated: z.ZodLiteral<true>;
                limitations: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                validated: z.ZodLiteral<false>;
                limitations: z.ZodArray<z.ZodString>;
            }, z.core.$strict>], "validated">;
            nonInferiority: z.ZodDiscriminatedUnion<[z.ZodObject<{
                validated: z.ZodLiteral<true>;
                limitations: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                validated: z.ZodLiteral<false>;
                limitations: z.ZodArray<z.ZodString>;
            }, z.core.$strict>], "validated">;
            randomized: z.ZodOptional<z.ZodObject<{
                withinP: z.ZodNumber;
                withinPAdjusted: z.ZodNumber;
                blockLower: z.ZodNumber;
                withinLower: z.ZodNumber;
                pairs: z.ZodInt;
                imputedTrials: z.ZodInt;
            }, z.core.$strict>>;
            flips: z.ZodArray<z.ZodObject<{
                case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
                direction: z.ZodEnum<{
                    negative: "negative";
                    positive: "positive";
                }>;
                base: z.ZodNumber;
                candidate: z.ZodNumber;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        verdict: z.ZodEnum<{
            "ESTIMATE-ONLY": "ESTIMATE-ONLY";
            INCONCLUSIVE: "INCONCLUSIVE";
            "NON-INFERIOR": "NON-INFERIOR";
            REGRESSION: "REGRESSION";
        }>;
        coverage: z.ZodNumber;
        blocks: z.ZodOptional<z.ZodObject<{
            planned: z.ZodInt;
            observed: z.ZodInt;
            effective: z.ZodNullable<z.ZodInt>;
            reason: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        noise: z.ZodOptional<z.ZodObject<{
            arms: z.ZodArray<z.ZodObject<{
                arm: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
                withinCaseVariance: z.ZodNullable<z.ZodNumber>;
                replicatedCells: z.ZodInt;
                caseDispersion: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strict>>;
            betweenBlockVariance: z.ZodNullable<z.ZodNumber>;
            contrastBlocks: z.ZodInt;
        }, z.core.$strict>>;
        sensitivity: z.ZodArray<z.ZodObject<{
            imputation: z.ZodEnum<{
                "against-non-inferiority": "against-non-inferiority";
                "against-regression": "against-regression";
            }>;
            difference: z.ZodObject<{
                estimate: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                    nonFinite: z.ZodEnum<{
                        "-inf": "-inf";
                        inf: "inf";
                        nan: "nan";
                    }>;
                }, z.core.$strict>]>;
                lower: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                    nonFinite: z.ZodEnum<{
                        "-inf": "-inf";
                        inf: "inf";
                        nan: "nan";
                    }>;
                }, z.core.$strict>]>;
                upper: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                    nonFinite: z.ZodEnum<{
                        "-inf": "-inf";
                        inf: "inf";
                        nan: "nan";
                    }>;
                }, z.core.$strict>]>;
                level: z.ZodNumber;
                sided: z.ZodEnum<{
                    lower: "lower";
                    two: "two";
                    upper: "upper";
                }>;
                method: z.ZodString;
            }, z.core.$strict>;
            nonInferiorityP: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                nonFinite: z.ZodEnum<{
                    "-inf": "-inf";
                    inf: "inf";
                    nan: "nan";
                }>;
            }, z.core.$strict>]>;
            regressionPAdjusted: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
                nonFinite: z.ZodEnum<{
                    "-inf": "-inf";
                    inf: "inf";
                    nan: "nan";
                }>;
            }, z.core.$strict>]>;
            regression: z.ZodDiscriminatedUnion<[z.ZodObject<{
                validated: z.ZodLiteral<true>;
                limitations: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                validated: z.ZodLiteral<false>;
                limitations: z.ZodArray<z.ZodString>;
            }, z.core.$strict>], "validated">;
            nonInferiority: z.ZodDiscriminatedUnion<[z.ZodObject<{
                validated: z.ZodLiteral<true>;
                limitations: z.ZodArray<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                validated: z.ZodLiteral<false>;
                limitations: z.ZodArray<z.ZodString>;
            }, z.core.$strict>], "validated">;
            verdict: z.ZodEnum<{
                "ESTIMATE-ONLY": "ESTIMATE-ONLY";
                INCONCLUSIVE: "INCONCLUSIVE";
                "NON-INFERIOR": "NON-INFERIOR";
                REGRESSION: "REGRESSION";
            }>;
            changesVerdict: z.ZodBoolean;
        }, z.core.$strict>>;
        notes: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    gates: z.ZodArray<z.ZodObject<{
        gate: z.core.$ZodBranded<z.ZodString, "GateId", "out">;
        passed: z.ZodBoolean;
        failures: z.ZodInt;
        detail: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    power: z.ZodObject<{
        planning: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
        run: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>;
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
        cases: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            status: z.ZodLiteral<"missing">;
            case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
            plannedTrials: z.ZodInt;
            validTrials: z.ZodInt;
        }, z.core.$strict>, z.ZodObject<{
            status: z.ZodEnum<{
                "estimate-only": "estimate-only";
                observed: "observed";
            }>;
            passAll: z.ZodNumber;
            passAny: z.ZodNumber;
            case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
            plannedTrials: z.ZodInt;
            validTrials: z.ZodInt;
        }, z.core.$strict>], "status">>;
        overall: z.ZodDiscriminatedUnion<[z.ZodObject<{
            status: z.ZodLiteral<"missing">;
        }, z.core.$strict>, z.ZodObject<{
            status: z.ZodEnum<{
                "estimate-only": "estimate-only";
                observed: "observed";
            }>;
            passAll: z.ZodNumber;
            passAny: z.ZodNumber;
        }, z.core.$strict>], "status">;
    }, z.core.$strict>>;
    mustNever: z.ZodOptional<z.ZodArray<z.ZodObject<{
        measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
        scope: z.ZodString;
        detector: z.ZodEnum<{
            deterministic: "deterministic";
            model: "model";
        }>;
        planned: z.ZodInt;
        clean: z.ZodInt;
        hits: z.ZodInt;
        missing: z.ZodInt;
        cases: z.ZodArray<z.ZodObject<{
            case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
            planned: z.ZodInt;
            observed: z.ZodInt;
            status: z.ZodEnum<{
                clean: "clean";
                hit: "hit";
                missing: "missing";
            }>;
            contexts: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
        windows: z.ZodArray<z.ZodObject<{
            block: z.ZodInt;
            startedAt: z.ZodISODateTime;
            endedAt: z.ZodISODateTime;
        }, z.core.$strict>>;
        controls: z.ZodArray<z.ZodObject<{
            pattern: z.ZodString;
            case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
            status: z.ZodEnum<{
                clean: "clean";
                hit: "hit";
                missing: "missing";
            }>;
        }, z.core.$strict>>;
    }, z.core.$strict>>>;
    missingness: z.ZodObject<{
        byArm: z.ZodArray<z.ZodObject<{
            arm: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
            missing: z.ZodInt;
            planned: z.ZodInt;
        }, z.core.$strict>>;
        differs: z.ZodBoolean;
        sensitivity: z.ZodEnum<{
            "adverse-completion": "adverse-completion";
            "changes-verdict": "changes-verdict";
            "not-needed": "not-needed";
            unchanged: "unchanged";
        }>;
    }, z.core.$strict>;
    invalidReasons: z.ZodArray<z.ZodString>;
    limitations: z.ZodArray<z.ZodString>;
    seed: z.ZodObject<{
        algorithm: z.ZodString;
        value: z.ZodString;
    }, z.core.$strict>;
    decidedAt: z.ZodISODateTime;
    ichnaea: z.ZodString;
    dataClass: z.ZodEnum<{
        none: "none";
        personal: "personal";
        pseudonymous: "pseudonymous";
        special: "special";
    }>;
}, z.core.$strict>;
/** A decision. */
export type Decision = z.infer<typeof Decision>;
//# sourceMappingURL=decision.d.ts.map