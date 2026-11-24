/** Thrown when stored or offered records break the store's rules. The message names the record. */
export declare class StoreError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    readonly name = "StoreError";
}
/** Resolves all named areas of a run with the same encoding. */
export declare function runDirectory(root: string, area: "work" | "runs" | "owners", run: string): string;
//# sourceMappingURL=store-path.d.ts.map