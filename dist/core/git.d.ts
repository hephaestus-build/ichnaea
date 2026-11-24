export interface GitResult {
    readonly stdout: string;
    readonly status: number;
}
export declare function git(cwd: string, args: readonly string[]): Promise<GitResult>;
export declare function gitBytes(cwd: string, args: readonly string[]): Promise<{
    stdout: Buffer;
    status: number;
}>;
//# sourceMappingURL=git.d.ts.map