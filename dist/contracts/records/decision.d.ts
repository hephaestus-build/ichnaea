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
    missingness: z.ZodObject<{
        byArm: z.ZodArray<z.ZodObject<{
            arm: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
            missing: z.ZodInt;
            planned: z.ZodInt;
        }, z.core.$strict>>;
        differs: z.ZodBoolean;
        sensitivity: z.ZodEnum<{
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