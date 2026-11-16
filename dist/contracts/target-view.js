/** Returns the target's view of a case. */
export function caseForTarget(record) {
    const view = {
        id: record.id,
        unit: record.unit,
        input: structuredClone(record.input),
    };
    if (record.turns !== undefined)
        view.turns = structuredClone(record.turns);
    if (record.fixtures !== undefined)
        view.fixtures = structuredClone(record.fixtures);
    return view;
}
//# sourceMappingURL=target-view.js.map