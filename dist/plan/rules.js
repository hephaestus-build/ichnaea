/**
 * The parts of a configuration that each trigger varies by its kind (REQ-15). Arms may differ in
 * these parts and in the factor keys a plan declares in `varies`; any other difference between the
 * arms makes the run INVALID. `null` marks a trigger that changes nothing in the system under
 * evaluation (a case set, a judge, the framework itself, a production signal), so its arms may not
 * differ at all and it cannot declare anything as varied. A code or dependency change varies the
 * code, including its lockfile; a prompt or setting it also changes must be declared.
 */
export const TRIGGER_VARIES = {
    code: ["code"],
    dependency: ["code"],
    configuration: [],
    "configuration-outside": [],
    "new-model": ["model"],
    "silent-change": [],
    "case-set": null,
    judge: null,
    framework: null,
    data: ["data"],
    "production-signal": null,
    manual: [],
};
//# sourceMappingURL=rules.js.map