/** Execution mode of each hook. */
export const HOOK_MODES = {
    configResolved: "sequential",
    planCreated: "sequential",
    trialRecorded: "parallel",
    runCompleted: "sequential",
    decisionMade: "parallel",
    reportRendered: "parallel",
    beforeEgress: "sequential",
};
/**
 * Defines a plugin, keeping its literal ID and the literal IDs of its parts. The ID is inferred from
 * `id` alone, so a part outside the plugin's namespace is a type error.
 */
export function definePlugin(plugin) {
    return plugin;
}
/** Defines a measure, keeping its literal ID. */
export function defineMeasure(measure) {
    return measure;
}
/** Defines a configuration. The measures it can name are inferred from its plugins. */
export function defineConfig(config) {
    return config;
}
//# sourceMappingURL=plugin.js.map