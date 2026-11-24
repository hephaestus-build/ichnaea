/** A built-in command with options described by its help text. */
export interface CommandDefinition {
    readonly name: string;
    readonly description: string;
    readonly options: Readonly<Record<string, {
        readonly type: "string" | "boolean";
        readonly description: string;
    }>>;
    readonly run: (values: Readonly<Record<string, unknown>>, io: {
        readonly out: (text: string) => void;
        readonly err: (text: string) => void;
    }) => Promise<number>;
}
export declare const decideCommand: CommandDefinition;
export declare const reportCommand: CommandDefinition;
//# sourceMappingURL=commands.d.ts.map